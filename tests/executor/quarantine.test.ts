import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Operation } from '../../src/core/types.js';
import { quarantineOne } from '../../src/executor/quarantine.js';
import { readManifest } from '../../src/executor/manifest.js';
import { HomeInsideWorkspaceError } from '../../src/core/home.js';

const DIA = new Date('2026-09-26T10:00:00.000Z');
const existe = (p: string) => access(p).then(() => true, () => false);

let base: string;
let root: string;
let home: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-q-'));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  await mkdir(root);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

async function opPara(rel: string, id = 'OP-000001'): Promise<Operation> {
  const buf = await readFile(path.join(root, rel));
  return {
    id, type: 'quarantine', path: rel, findingIds: ['F-000001'], ruleIds: ['FS-TEMP-001'],
    risk: 'safe', reason: 'Fichero de log abandonado', degradedFrom: null, degradeReason: null,
    source: { sha256: createHash('sha256').update(buf).digest('hex'), size: buf.length },
  };
}

describe('quarantineOne', () => {
  it('mueve el fichero a la cuarentena y deja un manifiesto completo', async () => {
    await writeFile(path.join(root, 'debug.log'), 'log');
    const op = await opPara('debug.log');

    const r = await quarantineOne({ root, home, op, now: DIA });
    expect(r).toEqual({ status: 'quarantined', opId: 'OP-000001', path: 'debug.log', entry: '2026-09-26/OP-000001' });
    expect(await existe(path.join(root, 'debug.log'))).toBe(false);

    const m = await readManifest(path.join(home, 'quarantine', '2026-09-26', 'OP-000001'));
    expect(m).toMatchObject({
      state: 'quarantined', operation_id: 'OP-000001', relative_path: 'debug.log',
      source: path.join(root, 'debug.log'), sha256: op.source.sha256, size: 3,
      rule_ids: ['FS-TEMP-001'], restorable: true, restored_at: null,
    });
    expect(await readFile(m.quarantine_path, 'utf8')).toBe('log');
  });

  it('omite la operacion si el contenido cambio desde la aprobacion', async () => {
    const p = path.join(root, 'debug.log');
    await writeFile(p, 'aaa');
    const op = await opPara('debug.log');
    await writeFile(p, 'bbb');

    const r = await quarantineOne({ root, home, op });
    expect(r).toMatchObject({ status: 'skipped', reason: expect.stringContaining('contenido') });
    expect(await readFile(p, 'utf8')).toBe('bbb');
    expect(await existe(path.join(home, 'quarantine'))).toBe(false);
  });

  it('omite la operacion si el origen ya no existe', async () => {
    await writeFile(path.join(root, 'debug.log'), 'x');
    const op = await opPara('debug.log');
    await rm(path.join(root, 'debug.log'));
    expect(await quarantineOne({ root, home, op })).toMatchObject({ status: 'skipped' });
  });

  it('se niega a operar si la base cae dentro del workspace', async () => {
    const p = path.join(root, 'debug.log');
    await writeFile(p, 'x');
    const op = await opPara('debug.log');
    await expect(quarantineOne({ root, home: path.join(root, '.hygiene'), op }))
      .rejects.toBeInstanceOf(HomeInsideWorkspaceError);
    expect(await existe(p)).toBe(true);
  });

  it('si el movimiento falla, el origen sigue en su sitio y la entrada queda pending', async () => {
    const p = path.join(root, 'debug.log');
    await writeFile(p, 'x');
    const op = await opPara('debug.log');
    const falla = async (): Promise<void> => {
      throw Object.assign(new Error('bloqueado'), { code: 'EBUSY' });
    };

    const r = await quarantineOne({ root, home, op, now: DIA, moveDeps: { rename: falla } });
    expect(r).toMatchObject({ status: 'failed', reason: 'bloqueado' });
    expect(await existe(p)).toBe(true);
    const m = await readManifest(path.join(home, 'quarantine', '2026-09-26', 'OP-000001'));
    expect(m.state).toBe('pending');
  });
});
