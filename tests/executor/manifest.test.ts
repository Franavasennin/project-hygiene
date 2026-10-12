import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  allocateEntry, findEntries, readManifest, writeManifest,
  InvalidEntryRefError, type Manifest,
} from '../../src/executor/manifest.js';

const DIA = new Date('2026-09-26T10:00:00.000Z');
let home: string;
beforeEach(async () => { home = await mkdtemp(path.join(tmpdir(), 'hyg-man-')); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

function manifiesto(extra: Partial<Manifest> = {}): Manifest {
  return {
    schema_version: 1, operation_id: 'OP-000001', entry: '2026-09-26/OP-000001',
    state: 'quarantined', created_at: DIA.toISOString(), restored_at: null,
    root: '/ws', relative_path: 'debug.log', source: '/ws/debug.log',
    quarantine_path: '/h/debug.log', sha256: 'abc', size: 1, platform: 'linux',
    permissions: { model: 'none', captured: false, data: null },
    rule_ids: ['FS-TEMP-001'], reason: 'r', restorable: true, restore_report: null,
    ...extra,
  };
}

async function crear(opId: string, state: Manifest['state'] = 'quarantined'): Promise<string> {
  const { entry, dir } = await allocateEntry(home, opId, DIA);
  await writeManifest(dir, manifiesto({ operation_id: opId, entry, state }));
  return entry;
}

describe('allocateEntry', () => {
  it('crea quarantine/<fecha>/<OP-ID>', async () => {
    const e = await allocateEntry(home, 'OP-000001', DIA);
    expect(e.entry).toBe('2026-09-26/OP-000001');
    expect(e.dir).toBe(path.join(home, 'quarantine', '2026-09-26', 'OP-000001'));
  });

  it('no pisa una entrada existente con el mismo OP-ID', async () => {
    await allocateEntry(home, 'OP-000001', DIA);
    expect((await allocateEntry(home, 'OP-000001', DIA)).entry).toBe('2026-09-26/OP-000001-2');
  });
});

describe('manifiesto', () => {
  it('se escribe y se lee sin dejar temporales', async () => {
    const { dir } = await allocateEntry(home, 'OP-000001', DIA);
    await writeManifest(dir, manifiesto());
    expect(await readManifest(dir)).toEqual(manifiesto());
    expect(await readdir(dir)).toEqual(['manifest.json']);
  });
});

describe('findEntries', () => {
  it('sin cuarentena devuelve una lista vacia', async () => {
    expect(await findEntries(home, 'OP-000001')).toEqual([]);
  });

  it('encuentra todas las entradas activas de un OP-ID', async () => {
    await crear('OP-000001');
    await crear('OP-000001');
    await crear('OP-000002');
    expect((await findEntries(home, 'OP-000001')).map((e) => e.entry))
      .toEqual(['2026-09-26/OP-000001', '2026-09-26/OP-000001-2']);
  });

  it('prefiere las entradas no restauradas', async () => {
    await crear('OP-000001', 'restored');
    await crear('OP-000001');
    expect((await findEntries(home, 'OP-000001')).map((e) => e.entry)).toEqual(['2026-09-26/OP-000001-2']);
  });

  it('si todas estan restauradas, las devuelve para poder decirlo', async () => {
    await crear('OP-000001', 'restored');
    expect((await findEntries(home, 'OP-000001')).map((e) => e.manifest.state)).toEqual(['restored']);
  });

  it('acepta una referencia exacta fecha/entrada', async () => {
    await crear('OP-000001');
    await crear('OP-000001');
    expect((await findEntries(home, '2026-09-26/OP-000001-2')).map((e) => e.entry))
      .toEqual(['2026-09-26/OP-000001-2']);
  });

  it('rechaza referencias que podrian salir de la cuarentena', async () => {
    await expect(findEntries(home, '../../etc')).rejects.toBeInstanceOf(InvalidEntryRefError);
    await expect(findEntries(home, '2026-09-26/../../x')).rejects.toBeInstanceOf(InvalidEntryRefError);
  });
});
