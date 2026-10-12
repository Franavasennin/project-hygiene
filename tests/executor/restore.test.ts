import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Operation } from '../../src/core/types.js';
import { quarantineOne } from '../../src/executor/quarantine.js';
import { findEntries, readManifest, writeManifest, type QuarantineEntry } from '../../src/executor/manifest.js';
import { restoreEntry } from '../../src/executor/restore.js';

const DIA = new Date('2026-09-26T10:00:00.000Z');
const existe = (p: string) => access(p).then(() => true, () => false);

let base: string;
let root: string;
let home: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-rs-'));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  await mkdir(root);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

async function enCuarentena(rel: string, contenido: string): Promise<QuarantineEntry> {
  const abs = path.join(root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, contenido);
  const buf = await readFile(abs);
  const op: Operation = {
    id: 'OP-000001', type: 'quarantine', path: rel, findingIds: ['F-000001'], ruleIds: ['FS-TEMP-001'],
    risk: 'safe', reason: 'r', degradedFrom: null, degradeReason: null,
    source: { sha256: createHash('sha256').update(buf).digest('hex'), size: buf.length },
  };
  const r = await quarantineOne({ root, home, op, now: DIA });
  if (r.status !== 'quarantined') throw new Error(`preparacion fallida: ${r.status}`);
  const [e] = await findEntries(home, 'OP-000001');
  return e!;
}

describe('restoreEntry', () => {
  it('devuelve el fichero a su ruta con el mismo hash y marca la entrada', async () => {
    const e = await enCuarentena('debug.log', 'log');
    const r = await restoreEntry(e, DIA);
    expect(r).toMatchObject({ status: 'restored', source: path.join(root, 'debug.log') });
    expect(await readFile(path.join(root, 'debug.log'), 'utf8')).toBe('log');

    const m = await readManifest(e.dir);
    expect(m.state).toBe('restored');
    expect(m.restored_at).toBe(DIA.toISOString());
    expect(m.restore_report).not.toBeNull();
  });

  it('recrea el directorio padre si ya no existe', async () => {
    const e = await enCuarentena('logs/viejo.log', 'x');
    await rm(path.join(root, 'logs'), { recursive: true });
    expect((await restoreEntry(e)).status).toBe('restored');
    expect(await readFile(path.join(root, 'logs', 'viejo.log'), 'utf8')).toBe('x');
  });

  it('aborta sin tocar el workspace si el payload fue alterado', async () => {
    const e = await enCuarentena('debug.log', 'log');
    await writeFile(e.manifest.quarantine_path, 'manipulado');

    const r = await restoreEntry(e);
    expect(r).toMatchObject({ status: 'aborted', reason: expect.stringContaining('hash') });
    expect(await existe(path.join(root, 'debug.log'))).toBe(false);
    expect(await readFile(e.manifest.quarantine_path, 'utf8')).toBe('manipulado');
  });

  it('no sobrescribe un fichero que ya ocupa la ruta', async () => {
    const e = await enCuarentena('debug.log', 'log');
    await writeFile(path.join(root, 'debug.log'), 'nuevo');
    expect((await restoreEntry(e)).status).toBe('aborted');
    expect(await readFile(path.join(root, 'debug.log'), 'utf8')).toBe('nuevo');
  });

  it('una entrada ya restaurada no se restaura dos veces', async () => {
    const e = await enCuarentena('debug.log', 'log');
    await restoreEntry(e);
    const [otra] = await findEntries(home, 'OP-000001');
    expect(await restoreEntry(otra!)).toMatchObject({ status: 'aborted', reason: expect.stringContaining('ya se restauro') });
  });

  it('una entrada pending sin payload explica que el origen no se llego a mover', async () => {
    const e = await enCuarentena('debug.log', 'log');
    await writeManifest(e.dir, { ...e.manifest, state: 'pending' });
    await rm(e.manifest.quarantine_path);
    const [pendiente] = await findEntries(home, 'OP-000001');
    expect(await restoreEntry(pendiente!)).toMatchObject({ status: 'aborted', reason: expect.stringContaining('no llego a moverse') });
  });
});
