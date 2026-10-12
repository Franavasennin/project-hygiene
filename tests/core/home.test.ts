import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { resolveHome, assertHomeOutside, HomeInsideWorkspaceError } from '../../src/core/home.js';

let base: string;
beforeEach(async () => { base = await mkdtemp(path.join(tmpdir(), 'hyg-home-')); });
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

describe('resolveHome', () => {
  it('usa HYGIENE_HOME cuando esta definida', () => {
    expect(resolveHome({ HYGIENE_HOME: path.join(base, 'h') })).toBe(path.join(base, 'h'));
  });

  it('cae en ~/.hygiene si no hay variable', () => {
    expect(resolveHome({})).toBe(path.join(homedir(), '.hygiene'));
  });

  it('ignora una variable vacia', () => {
    expect(resolveHome({ HYGIENE_HOME: '  ' })).toBe(path.join(homedir(), '.hygiene'));
  });
});

describe('assertHomeOutside', () => {
  it('acepta una base hermana del workspace', async () => {
    const ws = path.join(base, 'ws');
    await mkdir(ws);
    await expect(assertHomeOutside(path.join(base, 'hyg'), ws)).resolves.toBeUndefined();
  });

  it('rechaza una base dentro del workspace aunque aun no exista', async () => {
    const ws = path.join(base, 'ws');
    await mkdir(ws);
    await expect(assertHomeOutside(path.join(ws, '.hygiene'), ws))
      .rejects.toBeInstanceOf(HomeInsideWorkspaceError);
  });

  it('rechaza una base igual al workspace', async () => {
    const ws = path.join(base, 'ws');
    await mkdir(ws);
    await expect(assertHomeOutside(ws, ws)).rejects.toBeInstanceOf(HomeInsideWorkspaceError);
  });

  it('rechaza un workspace dentro de la base', async () => {
    const hyg = path.join(base, 'hyg');
    const ws = path.join(hyg, 'ws');
    await mkdir(ws, { recursive: true });
    await expect(assertHomeOutside(hyg, ws)).rejects.toBeInstanceOf(HomeInsideWorkspaceError);
  });

  it('no confunde un prefijo de nombre con contencion', async () => {
    const ws = path.join(base, 'ws');
    await mkdir(ws);
    await expect(assertHomeOutside(path.join(base, 'ws-hygiene'), ws)).resolves.toBeUndefined();
  });
});
