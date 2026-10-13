import type { Operation } from './core/types.js';
import type { Limits } from './core/limits.js';
import { assertHomeOutside } from './core/home.js';
import { runPlan } from './plan.js';
import {
  approvalKey, deleteApprovals, loadApprovals, type ApprovedOperation,
} from './approvals/store.js';
import { quarantineOne, type QuarantineOutcome } from './executor/quarantine.js';
import { ignoreOne } from './executor/ignore.js';
import type { EditOutcome } from './executor/edit.js';

export interface CleanOptions {
  root: string;
  rulesDir: string;
  home: string;
  limits?: Partial<Limits>;
  minConfidence?: number;
  defaultBranch?: string;
  now?: Date;
}

export type ExecOutcome = QuarantineOutcome | EditOutcome;

export type CleanResult =
  | { status: 'no-approvals' }
  | { status: 'stale'; stale: ApprovedOperation[] }
  | { status: 'executed'; outcomes: ExecOutcome[] };

/** Barrera final (spec §9): solo se ejecuta lo registrado como aprobado. */
export async function runClean(o: CleanOptions): Promise<CleanResult> {
  const approvals = await loadApprovals(o.home, o.root);
  if (!approvals || approvals.operations.length === 0) return { status: 'no-approvals' };
  await assertHomeOutside(o.home, o.root);

  // Una aprobacion caduca si el plan que la origino ya no coincide con el
  // disco: cada operacion aprobada tiene que seguir en el plan recalculado
  // ahora, con el mismo tipo, ruta y hash. Si falta una, no se mueve nada.
  const { plan } = await runPlan({
    root: o.root, rulesDir: o.rulesDir, limits: o.limits,
    minConfidence: o.minConfidence, defaultBranch: o.defaultBranch,
  });
  const current = new Map(plan.operations.map((op) => [
    approvalKey({ type: op.type, path: op.path, sha256: op.source.sha256 }), op,
  ]));

  const matched: Operation[] = [];
  const stale: ApprovedOperation[] = [];
  for (const a of approvals.operations) {
    const op = current.get(approvalKey(a));
    // Se conserva el OP-ID que el usuario aprobo: es el que vera en restore.
    if (op) matched.push({ ...op, id: a.id });
    else stale.push(a);
  }
  if (stale.length > 0) return { status: 'stale', stale };

  const outcomes: ExecOutcome[] = [];
  // Varias operaciones ignore pueden editar el mismo .gitignore en este
  // clean: cada una espera la huella que dejo la anterior, no la aprobada.
  const fingerprints = new Map<string, string>();
  for (const op of matched) {
    try {
      if (op.type === 'ignore' && op.edit) {
        const r = await ignoreOne({
          root: o.root, home: o.home, op, now: o.now, expectedBefore: fingerprints.get(op.edit.file),
        });
        if (r.status === 'applied') fingerprints.set(op.edit.file, r.after);
        outcomes.push(r);
      } else {
        outcomes.push(await quarantineOne({ root: o.root, home: o.home, op, now: o.now }));
      }
    } catch (err) {
      outcomes.push({
        status: 'failed', opId: op.id, path: op.path,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Una aprobacion vale para una sola ejecucion.
  await deleteApprovals(o.home, o.root);
  return { status: 'executed', outcomes };
}
