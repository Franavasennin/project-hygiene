import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { assertHomeOutside } from '../core/home.js';
import { capturePermissions } from './permissions.js';
import { allocateEntry, writeManifest, type Manifest } from './manifest.js';

/** Huella de un fichero que no existe. */
export const ABSENT = 'absent';

export function fingerprintText(content: string | null): string {
  return content === null ? ABSENT : createHash('sha256').update(content).digest('hex');
}

export async function readTextOrNull(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Escribe en un temporal del mismo directorio y renombra: nunca deja un fichero a medias. */
export async function writeTextAtomic(abs: string, content: string): Promise<void> {
  const tmp = `${abs}.hygiene-tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, abs);
}

export interface EditRequest {
  root: string;
  home: string;
  opId: string;
  /** Ruta relativa al root, con separador '/'. */
  file: string;
  transform(current: string | null): string;
  /** Huella aprobada; si el fichero ya no la tiene, no se edita. */
  expectedBefore?: string;
  mode?: number;
  ruleIds: string[];
  reason: string;
  now?: Date;
}

export type EditOutcome =
  | { status: 'applied'; opId: string; path: string; entry: string; after: string; created: boolean }
  | { status: 'unchanged'; opId: string; path: string }
  | { status: 'skipped'; opId: string; path: string; reason: string }
  | { status: 'failed'; opId: string; path: string; reason: string };

/**
 * Edicion registrada (decision 10): copia del original en payload/, manifiesto
 * pending antes de escribir y huellas antes/despues para que restore solo
 * deshaga si nadie ha tocado el fichero despues.
 */
export async function applyEdit(req: EditRequest): Promise<EditOutcome> {
  const base = { opId: req.opId, path: req.file };
  await assertHomeOutside(req.home, req.root);
  const abs = path.join(req.root, req.file);
  const current = await readTextOrNull(abs);
  const before = fingerprintText(current);
  if (req.expectedBefore !== undefined && before !== req.expectedBefore) {
    return { status: 'skipped', ...base, reason: 'el fichero ha cambiado desde la aprobacion' };
  }
  const next = req.transform(current);
  if (next === current) return { status: 'unchanged', ...base };

  const now = req.now ?? new Date();
  const { entry, dir } = await allocateEntry(req.home, req.opId, now);
  let backup = '';
  if (current !== null) {
    await mkdir(path.join(dir, 'payload'));
    backup = path.join(dir, 'payload', path.basename(abs));
    await writeFile(backup, current, 'utf8');
  }
  const after = fingerprintText(next);
  const manifest: Manifest = {
    schema_version: 1,
    operation_id: req.opId,
    entry,
    state: 'pending',
    created_at: now.toISOString(),
    restored_at: null,
    root: req.root,
    relative_path: req.file,
    source: abs,
    quarantine_path: backup,
    sha256: after,
    size: Buffer.byteLength(next),
    platform: process.platform,
    permissions: current !== null
      ? await capturePermissions(abs, dir)
      : { model: 'none', captured: false, data: null },
    rule_ids: req.ruleIds,
    reason: req.reason,
    restorable: true,
    restore_report: null,
    kind: 'edit',
    edit: { before_sha256: current === null ? null : before, after_sha256: after },
  };
  await writeManifest(dir, manifest);

  try {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeTextAtomic(abs, next);
    if (req.mode !== undefined) await chmod(abs, req.mode);
  } catch (err) {
    return { status: 'failed', ...base, reason: err instanceof Error ? err.message : String(err) };
  }

  await writeManifest(dir, { ...manifest, state: 'quarantined' });
  return { status: 'applied', ...base, entry, after, created: current === null };
}
