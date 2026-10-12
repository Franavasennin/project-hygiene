import type {
  DegradeReason, FileEntry, Finding, Inventory, Operation, OperationType, Risk,
} from '../core/types.js';

/**
 * Tipos que el executor sabe aplicar en esta version. El resto se planifica
 * y se muestra, pero approve lo rechaza: ignore/move/create llegan con init.
 */
export const EXECUTABLE_TYPES: ReadonlySet<OperationType> = new Set<OperationType>(['quarantine']);

export interface PlannerPolicy {
  /** Por debajo de esta confianza toda operacion se degrada a review. */
  minConfidence: number;
}

export const DEFAULT_POLICY: PlannerPolicy = { minConfidence: 0.8 };

export interface PlannerInput {
  findings: Finding[];
  inventory: Inventory;
  referenced: Set<string>;
  referencesComplete: boolean;
  /** sha256 de los candidatos a cuarentena; null si no se pudo calcular. */
  hashes: Map<string, string | null>;
  policy: PlannerPolicy;
}

interface Resolution {
  type: OperationType;
  degradedFrom: OperationType | null;
  degradeReason: DegradeReason | null;
}

const RISK_RANK: Record<Risk, number> = { safe: 0, low: 1, medium: 2, high: 3, unknown: 4 };

// Comparacion por unidad de codigo, no localeCompare: el orden de los IDs no
// puede depender de la configuracion regional de la maquina.
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function insideUnknownBoundary(p: string, inventory: Inventory): boolean {
  return inventory.projects.some((c) =>
    c.status === 'unknown-boundary'
    && (c.path === '.' || p === c.path || p.startsWith(`${c.path}/`)));
}

/** Aplica las reglas del planner de la spec §6 a un hallazgo. */
function resolve(f: Finding, input: PlannerInput, byPath: Map<string, FileEntry>): Resolution {
  const primary: OperationType = f.suggests[0] ?? 'review';
  const degrade = (reason: DegradeReason): Resolution => (
    primary === 'review'
      ? { type: 'review', degradedFrom: null, degradeReason: null }
      : { type: 'review', degradedFrom: primary, degradeReason: reason });

  if (f.risk === 'unknown') return degrade('unknown-risk');
  if (primary === 'none') return { type: 'none', degradedFrom: null, degradeReason: null };
  if (insideUnknownBoundary(f.path, input.inventory)) return degrade('unknown-project-boundary');
  if (f.confidence < input.policy.minConfidence) return degrade('low-confidence');

  if (primary === 'quarantine') {
    const entry = byPath.get(f.path);
    if (!entry || entry.isDir || entry.isSymlink || entry.notDescended) return degrade('not-a-regular-file');
    if (input.referenced.has(f.path)) return degrade('referenced-by-source');
    if (!input.referencesComplete) return degrade('references-undetermined');
    if (!input.hashes.get(f.path)) return degrade('hash-unavailable');
  }
  return { type: primary, degradedFrom: null, degradeReason: null };
}

/** Varias reglas sobre la misma ruta: si no coinciden, gana review. */
function merge(resolutions: Resolution[]): Resolution {
  const types = [...new Set(resolutions.map((r) => r.type))].filter((t) => t !== 'none');
  if (types.length === 0) return { type: 'none', degradedFrom: null, degradeReason: null };
  if (types.length === 1) {
    const type = types[0]!;
    const degraded = resolutions.find((r) => r.type === type && r.degradedFrom !== null);
    return degraded ?? { type, degradedFrom: null, degradeReason: null };
  }
  const firstActive = types.find((t) => t !== 'review') ?? null;
  return { type: 'review', degradedFrom: firstActive, degradeReason: 'conflicting-suggestions' };
}

/**
 * Convierte hallazgos en operaciones. Funcion pura y determinista: el mismo
 * inventario y los mismos hallazgos producen los mismos IDs.
 */
export function planOperations(input: PlannerInput): Operation[] {
  const byPath = new Map(input.inventory.files.map((e) => [e.path, e]));
  const sorted = [...input.findings].sort((a, b) =>
    byCodeUnit(a.path, b.path) || byCodeUnit(a.ruleId, b.ruleId) || byCodeUnit(a.id, b.id));

  const groups = new Map<string, Finding[]>();
  for (const f of sorted) {
    const list = groups.get(f.path) ?? [];
    list.push(f);
    groups.set(f.path, list);
  }

  const ops: Operation[] = [];
  for (const [p, group] of groups) {
    const r = merge(group.map((f) => resolve(f, input, byPath)));
    if (r.type === 'none') continue;
    const risk = group.reduce<Risk>(
      (acc, f) => (RISK_RANK[f.risk] > RISK_RANK[acc] ? f.risk : acc), 'safe');
    ops.push({
      id: `OP-${String(ops.length + 1).padStart(6, '0')}`,
      type: r.type,
      path: p,
      findingIds: group.map((f) => f.id),
      ruleIds: [...new Set(group.map((f) => f.ruleId))],
      risk,
      reason: [...new Set(group.map((f) => f.reason))].join('; '),
      degradedFrom: r.degradedFrom,
      degradeReason: r.degradeReason,
      source: { sha256: input.hashes.get(p) ?? null, size: byPath.get(p)?.size ?? 0 },
    });
  }
  return ops;
}
