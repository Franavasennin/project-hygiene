import type { Operation } from '../core/types.js';
import { applyEdit, type EditOutcome } from './edit.js';

export function appendLine(current: string | null, line: string): string {
  const text = current ?? '';
  if (text.split(/\r?\n/).some((l) => l.trim() === line)) return text;
  const sep = text === '' || text.endsWith('\n') ? '' : '\n';
  return `${text}${sep}${line}\n`;
}

export interface IgnoreRequest {
  root: string;
  home: string;
  op: Operation;
  now?: Date;
  /** Huella esperada si otra operacion de este mismo clean ya edito el fichero. */
  expectedBefore?: string;
}

export async function ignoreOne(req: IgnoreRequest): Promise<EditOutcome> {
  const { op } = req;
  if (op.type !== 'ignore' || !op.edit || !op.source.sha256) {
    return { status: 'skipped', opId: op.id, path: op.path, reason: 'la operacion no es un ignore ejecutable' };
  }
  const { line } = op.edit;
  const outcome = await applyEdit({
    root: req.root,
    home: req.home,
    opId: op.id,
    file: op.edit.file,
    expectedBefore: req.expectedBefore ?? op.source.sha256,
    transform: (current) => appendLine(current, line),
    ruleIds: op.ruleIds,
    reason: op.reason,
    now: req.now,
  });
  return { ...outcome, path: op.path };
}
