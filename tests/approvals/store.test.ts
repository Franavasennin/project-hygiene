import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  approvalFile, deleteApprovals, loadApprovals, rootKey, saveApprovals,
  ApprovalFileError, type ApprovalRecord,
} from '../../src/approvals/store.js';
import { HomeInsideWorkspaceError } from '../../src/core/home.js';

let base: string;
let home: string;
let ws: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-apr-'));
  home = path.join(base, 'home');
  ws = path.join(base, 'ws');
  await mkdir(ws);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

function registro(extra: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    schema_version: 1,
    root: ws,
    planId: '0123456789abcdef',
    updatedAt: '2026-09-26T00:00:00.000Z',
    requests: [],
    operations: [{
      id: 'OP-000001', type: 'quarantine', path: 'debug.log', sha256: 'abc',
      size: 1, risk: 'safe', ruleIds: ['FS-TEMP-001'],
    }],
    ...extra,
  };
}

describe('almacen de aprobaciones', () => {
  it('guarda y vuelve a leer el mismo registro', async () => {
    const file = await saveApprovals(home, registro());
    expect(file).toBe(approvalFile(home, ws));
    expect(await loadApprovals(home, ws)).toEqual(registro());
  });

  it('no deja ficheros temporales', async () => {
    await saveApprovals(home, registro());
    expect(await readdir(path.join(home, 'approvals'))).toEqual([`${rootKey(ws)}.json`]);
  });

  it('devuelve null si no hay aprobaciones', async () => {
    expect(await loadApprovals(home, ws)).toBeNull();
  });

  it('un fichero corrupto es un error, no un registro vacio', async () => {
    await mkdir(path.join(home, 'approvals'), { recursive: true });
    await writeFile(approvalFile(home, ws), '{ no es json');
    await expect(loadApprovals(home, ws)).rejects.toBeInstanceOf(ApprovalFileError);
  });

  it('un registro de otro workspace es un error', async () => {
    await mkdir(path.join(home, 'approvals'), { recursive: true });
    await writeFile(approvalFile(home, ws), JSON.stringify(registro({ root: path.join(base, 'otro') })));
    await expect(loadApprovals(home, ws)).rejects.toBeInstanceOf(ApprovalFileError);
  });

  it('deleteApprovals informa si habia algo que borrar', async () => {
    expect(await deleteApprovals(home, ws)).toBe(false);
    await saveApprovals(home, registro());
    expect(await deleteApprovals(home, ws)).toBe(true);
    expect(await loadApprovals(home, ws)).toBeNull();
  });

  it('se niega a escribir si la base cae dentro del workspace', async () => {
    await expect(saveApprovals(path.join(ws, '.hygiene'), registro()))
      .rejects.toBeInstanceOf(HomeInsideWorkspaceError);
  });

  it('la clave depende de la ruta del workspace', () => {
    expect(rootKey(ws)).toBe(rootKey(ws));
    expect(rootKey(ws)).not.toBe(rootKey(path.join(base, 'otro')));
  });
});
