import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OperationType, Risk } from '../core/types.js';
import { assertHomeOutside } from '../core/home.js';

export interface ApprovedOperation {
  /** ID en el plan al aprobarse. Informativo: la identidad es tipo + ruta + hash. */
  id: string;
  type: OperationType;
  path: string;
  sha256: string;
  size: number;
  risk: Risk;
  ruleIds: string[];
}

export interface ApprovalRequest {
  at: string;
  /** Lo que pidio el usuario, p. ej. ['--risk', 'safe'] u ['OP-000001']. */
  args: string[];
  /** Los IDs concretos en que se materializo (spec §9). */
  expanded: string[];
}

export interface ApprovalRecord {
  schema_version: 1;
  root: string;
  planId: string;
  updatedAt: string;
  requests: ApprovalRequest[];
  operations: ApprovedOperation[];
}

export class ApprovalFileError extends Error {}

function normalizeRoot(root: string): string {
  const abs = path.resolve(root);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

export function approvalsDir(home: string): string {
  return path.join(home, 'approvals');
}

export function rootKey(root: string): string {
  return createHash('sha256').update(normalizeRoot(root)).digest('hex').slice(0, 16);
}

export function approvalFile(home: string, root: string): string {
  return path.join(approvalsDir(home), `${rootKey(root)}.json`);
}

/** Identidad de una operacion aprobada. */
export function approvalKey(op: { type: OperationType; path: string; sha256: string | null }): string {
  return `${op.type}\u0000${op.path}\u0000${op.sha256 ?? ''}`;
}

export async function loadApprovals(home: string, root: string): Promise<ApprovalRecord | null> {
  const file = approvalFile(home, root);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ApprovalFileError(`fichero de aprobaciones corrupto: ${file}`);
  }
  const rec = data as Partial<ApprovalRecord> | null;
  if (!rec || rec.schema_version !== 1 || !Array.isArray(rec.operations) || typeof rec.root !== 'string') {
    throw new ApprovalFileError(`fichero de aprobaciones con formato desconocido: ${file}`);
  }
  if (normalizeRoot(rec.root) !== normalizeRoot(root)) {
    throw new ApprovalFileError(`el fichero ${file} pertenece a otro workspace: ${rec.root}`);
  }
  return rec as ApprovalRecord;
}

/** Unico punto de escritura de approve: solo toca <home>/approvals/. */
export async function saveApprovals(home: string, record: ApprovalRecord): Promise<string> {
  await assertHomeOutside(home, record.root);
  const file = approvalFile(home, record.root);
  await mkdir(approvalsDir(home), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
  return file;
}

export async function deleteApprovals(home: string, root: string): Promise<boolean> {
  try {
    await rm(approvalFile(home, root));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
