import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Operation } from '../core/types.js';
import { assertHomeOutside } from '../core/home.js';
import { hashFile } from './hash.js';
import { moveFile, type MoveDeps } from './move.js';
import { capturePermissions } from './permissions.js';
import { allocateEntry, writeManifest, type Manifest } from './manifest.js';

export interface QuarantineRequest {
  root: string;
  home: string;
  op: Operation;
  now?: Date;
  moveDeps?: MoveDeps;
}

export type QuarantineOutcome =
  | { status: 'quarantined'; opId: string; path: string; entry: string }
  | { status: 'skipped'; opId: string; path: string; reason: string }
  | { status: 'failed'; opId: string; path: string; reason: string };

/**
 * CLEAN -> MOVE -> QUARANTINE -> MANIFEST (spec §8), con dos refuerzos: el
 * origen se revalida contra la huella aprobada justo antes de mover, y el
 * manifiesto se escribe en estado pending antes del movimiento para que un
 * corte a mitad deje una entrada recuperable.
 */
export async function quarantineOne(req: QuarantineRequest): Promise<QuarantineOutcome> {
  const { op } = req;
  const base = { opId: op.id, path: op.path };

  if (op.type !== 'quarantine') return { status: 'skipped', ...base, reason: `tipo ${op.type} no ejecutable` };
  const expected = op.source.sha256;
  if (!expected) return { status: 'skipped', ...base, reason: 'la operacion no tiene huella de origen' };

  await assertHomeOutside(req.home, req.root);
  const source = path.join(req.root, op.path);

  let st;
  try {
    st = await lstat(source);
  } catch {
    return { status: 'skipped', ...base, reason: 'el origen ya no existe' };
  }
  if (!st.isFile()) return { status: 'skipped', ...base, reason: 'el origen ya no es un fichero regular' };
  if (st.size !== op.source.size) {
    return { status: 'skipped', ...base, reason: 'el tamano del origen ha cambiado desde la aprobacion' };
  }
  if (await hashFile(source) !== expected) {
    return { status: 'skipped', ...base, reason: 'el contenido del origen ha cambiado desde la aprobacion' };
  }

  const now = req.now ?? new Date();
  const { entry, dir } = await allocateEntry(req.home, op.id, now);
  const payloadDir = path.join(dir, 'payload');
  await mkdir(payloadDir);
  const target = path.join(payloadDir, path.basename(source));

  const manifest: Manifest = {
    schema_version: 1,
    operation_id: op.id,
    entry,
    state: 'pending',
    created_at: now.toISOString(),
    restored_at: null,
    root: req.root,
    relative_path: op.path,
    source,
    quarantine_path: target,
    sha256: expected,
    size: st.size,
    platform: process.platform,
    permissions: await capturePermissions(source, dir),
    rule_ids: op.ruleIds,
    reason: op.reason,
    restorable: true,
    restore_report: null,
  };
  await writeManifest(dir, manifest);

  try {
    await moveFile(source, target, expected, req.moveDeps);
    if (await hashFile(target) !== expected) {
      return { status: 'failed', ...base, reason: `el payload de ${entry} no coincide con el hash; revisa la entrada antes de restaurar` };
    }
  } catch (err) {
    return { status: 'failed', ...base, reason: err instanceof Error ? err.message : String(err) };
  }

  await writeManifest(dir, { ...manifest, state: 'quarantined' });
  return { status: 'quarantined', ...base, entry };
}
