import type { Operation, Plan } from '../core/types.js';
import { EXECUTABLE_TYPES } from '../planner/plan.js';
import { approvalKey, type ApprovalRecord, type ApprovedOperation } from './store.js';

/** Niveles que acepta --risk, de menor a mayor. unknown nunca se aprueba por filtro. */
export const APPROVABLE_RISKS = ['safe', 'low', 'medium', 'high'] as const;
export type ApprovableRisk = typeof APPROVABLE_RISKS[number];

export interface SelectRequest {
  plan: Plan;
  ids: string[];
  /** Atajo: todo lo ejecutable con riesgo igual o menor. Se expande a IDs. */
  risk?: ApprovableRisk;
}

export interface Selection {
  selected: Operation[];
  errors: string[];
}

/** Todo o nada: con un solo error no se selecciona ninguna operacion. */
export function selectOperations(req: SelectRequest): Selection {
  const errors: string[] = [];
  const chosen = new Map<string, Operation>();
  const byId = new Map(req.plan.operations.map((o) => [o.id, o]));

  for (const id of req.ids) {
    const op = byId.get(id);
    if (!op) {
      errors.push(`${id} no existe en el plan actual`);
      continue;
    }
    if (!EXECUTABLE_TYPES.has(op.type)) {
      errors.push(`${id} es de tipo ${op.type}: no es ejecutable en esta version y no se aprueba`);
      continue;
    }
    chosen.set(op.id, op);
  }

  if (req.risk) {
    const limit = APPROVABLE_RISKS.indexOf(req.risk);
    for (const op of req.plan.operations) {
      if (!EXECUTABLE_TYPES.has(op.type) || op.risk === 'unknown') continue;
      if (APPROVABLE_RISKS.indexOf(op.risk) <= limit) chosen.set(op.id, op);
    }
  }

  if (errors.length > 0) return { selected: [], errors };
  const selected = [...chosen.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { selected, errors };
}

export function mergeApproval(
  existing: ApprovalRecord | null,
  plan: Plan,
  selected: Operation[],
  args: string[],
  now: Date,
): ApprovalRecord {
  const ops = new Map<string, ApprovedOperation>();
  for (const a of existing?.operations ?? []) ops.set(approvalKey(a), a);

  for (const op of selected) {
    if (!op.source.sha256) {
      throw new Error(`invariante roto: ${op.id} es ejecutable pero no tiene huella; sin huella no hay restore verificable`);
    }
    const approved: ApprovedOperation = {
      id: op.id,
      type: op.type,
      path: op.path,
      sha256: op.source.sha256,
      size: op.source.size,
      risk: op.risk,
      ruleIds: op.ruleIds,
    };
    ops.set(approvalKey(approved), approved);
  }

  const at = now.toISOString();
  return {
    schema_version: 1,
    root: plan.root,
    planId: plan.planId,
    updatedAt: at,
    requests: [...(existing?.requests ?? []), { at, args, expanded: selected.map((o) => o.id) }],
    operations: [...ops.values()].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0)),
  };
}
