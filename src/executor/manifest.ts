import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CapturedPermissions, PermissionRestore } from './permissions.js';

export type ManifestState = 'pending' | 'quarantined' | 'restored';

/** Formato de la spec §8, mas estado y datos de restauracion. */
export interface Manifest {
  schema_version: 1;
  operation_id: string;
  entry: string;
  state: ManifestState;
  created_at: string;
  restored_at: string | null;
  root: string;
  relative_path: string;
  source: string;
  quarantine_path: string;
  sha256: string;
  size: number;
  platform: NodeJS.Platform;
  permissions: CapturedPermissions;
  rule_ids: string[];
  reason: string;
  restorable: boolean;
  restore_report: { permissions: PermissionRestore } | null;
}

export interface QuarantineEntry {
  entry: string;
  dir: string;
  manifest: Manifest;
}

export class InvalidEntryRefError extends Error {}

const MANIFEST = 'manifest.json';
const OP_REF = /^OP-\d{6}$/;
// Formato cerrado: impide que una referencia con '..' salga de la cuarentena.
const ENTRY_REF = /^\d{4}-\d{2}-\d{2}\/OP-\d{6}(-\d+)?$/;

export function quarantineDir(home: string): string {
  return path.join(home, 'quarantine');
}

/** Crea quarantine/<AAAA-MM-DD>/<OP-ID>, o <OP-ID>-2, -3... si ya existe. */
export async function allocateEntry(home: string, opId: string, now: Date): Promise<{ entry: string; dir: string }> {
  const day = now.toISOString().slice(0, 10);
  const dayDir = path.join(quarantineDir(home), day);
  await mkdir(dayDir, { recursive: true });
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? opId : `${opId}-${n}`;
    const dir = path.join(dayDir, name);
    try {
      await mkdir(dir);
      return { entry: `${day}/${name}`, dir };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

/** Escritura atomica: temporal y rename. */
export async function writeManifest(dir: string, manifest: Manifest): Promise<void> {
  const file = path.join(dir, MANIFEST);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

export async function readManifest(dir: string): Promise<Manifest> {
  return JSON.parse(await readFile(path.join(dir, MANIFEST), 'utf8')) as Manifest;
}

async function listDir(p: string): Promise<string[]> {
  try {
    return (await readdir(p)).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Busca por referencia exacta AAAA-MM-DD/OP-000123[-n] o por OP-ID. Con OP-ID
 * devuelve las entradas no restauradas; si todas lo estan, las devuelve igual
 * para que restore pueda decir que ya se restauraron.
 */
export async function findEntries(home: string, ref: string): Promise<QuarantineEntry[]> {
  if (ENTRY_REF.test(ref)) {
    const dir = path.join(quarantineDir(home), ...ref.split('/'));
    try {
      return [{ entry: ref, dir, manifest: await readManifest(dir) }];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }
  if (!OP_REF.test(ref)) {
    throw new InvalidEntryRefError(`referencia no valida: ${ref}. Usa OP-000123 o AAAA-MM-DD/OP-000123`);
  }

  const found: QuarantineEntry[] = [];
  for (const day of await listDir(quarantineDir(home))) {
    for (const name of await listDir(path.join(quarantineDir(home), day))) {
      if (name !== ref && !name.startsWith(`${ref}-`)) continue;
      const dir = path.join(quarantineDir(home), day, name);
      const manifest = await readManifest(dir);
      if (manifest.operation_id === ref) found.push({ entry: `${day}/${name}`, dir, manifest });
    }
  }
  const active = found.filter((e) => e.manifest.state !== 'restored');
  return active.length > 0 ? active : found;
}
