import type { Plan } from '../core/types.js';
import { EXECUTABLE_TYPES } from '../planner/plan.js';

// Igual que report/human.ts: solo se imprimen campos conocidos (ID, tipo,
// riesgo, ruta, IDs de regla y titulos fijos de regla). Nunca evidencia.
export function renderPlan(plan: Plan): string {
  const out: string[] = [];
  out.push(`Plan ${plan.planId}  ${plan.operations.length} operaciones  umbral de confianza ${plan.minConfidence}`);
  out.push('');

  if (plan.operations.length === 0) out.push('Sin operaciones propuestas.');

  for (const op of plan.operations) {
    out.push(`  ${op.id}  ${op.type.padEnd(10)} ${op.risk.padEnd(7)} ${op.path}`);
    out.push(`             ${op.ruleIds.join(', ')}  ${op.reason}`);
    if (op.degradedFrom && op.degradeReason) {
      out.push(`             degradada desde ${op.degradedFrom}: ${op.degradeReason}`);
    }
    if (op.edit) out.push(`             anade "${op.edit.line}" a ${op.edit.file}`);
  }

  const approvable = plan.operations.filter((o) => EXECUTABLE_TYPES.has(o.type)).map((o) => o.id);
  out.push('');
  if (approvable.length > 0) {
    out.push(`Aprobables: ${approvable.join(' ')}`);
    out.push(`Para aprobar: hygiene approve <OP-ID...> --root "${plan.root}"`);
  }
  out.push('Este comando no ha modificado nada.');
  return out.join('\n');
}
