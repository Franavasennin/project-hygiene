import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuditResult, FileEntry, Inventory, Operation, Plan } from './core/types.js';
import { gitKeyFor } from './collectors/workspace.js';
import { fingerprintText } from './executor/edit.js';
import { ENGINE_VERSION } from './core/version.js';
import { collectAudit, type AuditOptions } from './audit.js';
import { planOperations, DEFAULT_POLICY, type IgnoreTarget, type PlannerPolicy } from './planner/plan.js';

export interface PlanOptions extends AuditOptions {
  minConfidence?: number;
}

export interface PlanRun {
  audit: AuditResult;
  plan: Plan;
}

/** Huella del plan: cambia si cambia cualquier operacion, su tipo, ruta u origen. */
export function planDigest(root: string, operations: Operation[]): string {
  const canonical = JSON.stringify({
    root,
    ops: operations.map((o) => [o.id, o.type, o.path, o.source.sha256]),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Destino de un ignore (decision 9): el .gitignore del proyecto git que
 * contiene la ruta, siempre dentro del workspace auditado.
 */
async function ignoreTargetFor(inv: Inventory, byPath: Map<string, FileEntry>, p: string): Promise<IgnoreTarget | null> {
  const key = gitKeyFor(inv.gitByProject, p);
  if (key === null) return null;
  const g = inv.gitByProject[key]!;
  const rel = key === '.' ? p : p.slice(key.length + 1);
  const file = key === '.' ? '.gitignore' : `${key}/.gitignore`;
  const isDir = byPath.get(p)?.isDir ?? false;
  const tracked = g.trackedFiles.has(p) || [...g.trackedFiles].some((t) => t.startsWith(`${p}/`));
  let current: string | null = null;
  try {
    current = await readFile(path.join(inv.root, file), 'utf8');
  } catch {
    current = null;
  }
  return { file, line: `/${rel}${isDir ? '/' : ''}`, fingerprint: fingerprintText(current), tracked };
}

/**
 * Read-only por contrato (NN-4): audita, calcula las huellas de los
 * candidatos a cuarentena y propone. No escribe un solo byte.
 */
export async function runPlan(options: PlanOptions): Promise<PlanRun> {
  const { result, facts } = await collectAudit(options);
  const byPath = new Map(result.inventory.files.map((e) => [e.path, e]));

  const hashes = new Map<string, string | null>();
  for (const f of result.findings) {
    if (f.suggests[0] !== 'quarantine' || hashes.has(f.path)) continue;
    const entry = byPath.get(f.path);
    hashes.set(f.path, entry && !entry.isDir && !entry.isSymlink
      ? await facts.content.hash(entry)
      : null);
  }

  const ignoreTargets = new Map<string, IgnoreTarget | null>();
  for (const f of result.findings) {
    if (f.suggests[0] !== 'ignore' || ignoreTargets.has(f.path)) continue;
    ignoreTargets.set(f.path, await ignoreTargetFor(result.inventory, byPath, f.path));
  }

  const policy: PlannerPolicy = {
    ...DEFAULT_POLICY,
    ...(options.minConfidence === undefined ? {} : { minConfidence: options.minConfidence }),
  };
  const operations = planOperations({
    findings: result.findings,
    inventory: result.inventory,
    referenced: facts.referenced,
    referencesComplete: facts.referencesComplete,
    hashes,
    policy,
    ignoreTargets,
  });

  return {
    audit: result,
    plan: {
      planId: planDigest(result.inventory.root, operations),
      root: result.inventory.root,
      createdAt: new Date().toISOString(),
      engineVersion: ENGINE_VERSION,
      minConfidence: policy.minConfidence,
      operations,
    },
  };
}
