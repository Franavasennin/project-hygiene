import { createHash } from 'node:crypto';
import type { AuditResult, Operation, Plan } from './core/types.js';
import type { Limits } from './core/limits.js';
import { ENGINE_VERSION } from './core/version.js';
import { collectAudit } from './audit.js';
import { planOperations, DEFAULT_POLICY, type PlannerPolicy } from './planner/plan.js';

export interface PlanOptions {
  root: string;
  rulesDir: string;
  limits?: Partial<Limits>;
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
