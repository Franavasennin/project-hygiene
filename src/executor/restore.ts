import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { hashFile } from './hash.js';
import { moveFile } from './move.js';
import { applyPermissions, type PermissionRestore } from './permissions.js';
import { writeManifest, type QuarantineEntry } from './manifest.js';

export type RestoreOutcome =
  | { status: 'restored'; entry: string; source: string; permissions: PermissionRestore }
  | { status: 'aborted'; entry: string; reason: string };

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * RESTORE -> VERIFY HASH -> RETURN (spec §8). Si el hash no coincide, o la
 * ruta original ya esta ocupada, aborta sin tocar el workspace.
 */
export async function restoreEntry(e: QuarantineEntry, now: Date = new Date()): Promise<RestoreOutcome> {
  const m = e.manifest;
  const abort = (reason: string): RestoreOutcome => ({ status: 'aborted', entry: e.entry, reason });

  if (m.state === 'restored') return abort('la entrada ya se restauro');
  if (!m.restorable) return abort('la entrada esta marcada como no restaurable');
  if (!(await exists(m.quarantine_path))) {
    return abort(m.state === 'pending'
      ? 'la operacion no llego a moverse: el origen deberia seguir en su sitio'
      : 'falta el payload de la entrada');
  }
  if (await hashFile(m.quarantine_path) !== m.sha256) {
    return abort('el hash del payload no coincide con el manifiesto');
  }
  // Existe una ventana entre esta comprobacion y el rename; rename en POSIX
  // sobrescribiria. Aceptado: el executor es de un solo usuario y esta
  // comprobacion cubre el caso real (el fichero se recreo despues del clean).
  if (await exists(m.source)) return abort(`ya existe un fichero en ${m.source}; no se sobrescribe`);

  await mkdir(path.dirname(m.source), { recursive: true });
  await moveFile(m.quarantine_path, m.source, m.sha256);
  if (await hashFile(m.source) !== m.sha256) {
    throw new Error(`el fichero restaurado en ${m.source} no coincide con el hash del manifiesto`);
  }

  const permissions = await applyPermissions(m.source, e.dir, m.permissions);
  await writeManifest(e.dir, {
    ...m,
    state: 'restored',
    restored_at: now.toISOString(),
    restore_report: { permissions },
  });
  return { status: 'restored', entry: e.entry, source: m.source, permissions };
}
