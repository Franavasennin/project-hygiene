import { lstat, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { hashFile } from './hash.js';
import { fingerprintText, readTextOrNull, writeTextAtomic } from './edit.js';
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

async function restoreEdit(e: QuarantineEntry, now: Date): Promise<RestoreOutcome> {
  const m = e.manifest;
  const edit = m.edit;
  const abort = (reason: string): RestoreOutcome => ({ status: 'aborted', entry: e.entry, reason });

  if (m.state === 'restored') return abort('la entrada ya se restauro');
  if (!edit) return abort('manifiesto de edicion sin datos de edicion');
  const current = await readTextOrNull(m.source);
  if (fingerprintText(current) !== edit.after_sha256) {
    return abort(m.state === 'pending'
      ? 'la edicion no llego a aplicarse: el fichero sigue como estaba'
      : 'el fichero cambio despues de la edicion; no se sobrescribe');
  }

  let permissions: PermissionRestore = 'restored';
  if (edit.before_sha256 === null) {
    // Lo creo hygiene: se aparta a la entrada en vez de borrarlo.
    await mkdir(path.join(e.dir, 'created'), { recursive: true });
    await moveFile(m.source, path.join(e.dir, 'created', path.basename(m.source)), edit.after_sha256);
  } else {
    const original = await readFile(m.quarantine_path, 'utf8');
    if (fingerprintText(original) !== edit.before_sha256) {
      return abort('la copia previa no coincide con su huella');
    }
    await writeTextAtomic(m.source, original);
    permissions = await applyPermissions(m.source, e.dir, m.permissions);
  }

  await writeManifest(e.dir, {
    ...m, state: 'restored', restored_at: now.toISOString(), restore_report: { permissions },
  });
  return { status: 'restored', entry: e.entry, source: m.source, permissions };
}

/**
 * RESTORE -> VERIFY HASH -> RETURN (spec §8). Si el hash no coincide, o la
 * ruta original ya esta ocupada, aborta sin tocar el workspace.
 */
export async function restoreEntry(e: QuarantineEntry, now: Date = new Date()): Promise<RestoreOutcome> {
  if (e.manifest.kind === 'edit') return restoreEdit(e, now);
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
