import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { invokedDirectly } from '../../src/cli/index.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'hyg-entry-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('invokedDirectly', () => {
  it('reconoce la ejecucion directa del modulo', async () => {
    const real = path.join(dir, 'index.js');
    await writeFile(real, '');
    expect(invokedDirectly(real, real)).toBe(true);
    expect(invokedDirectly(path.join(dir, 'otro.js'), real)).toBe(false);
    expect(invokedDirectly(undefined, real)).toBe(false);
  });

  it('reconoce la ejecucion a traves de un enlace, como node_modules/.bin/hygiene', async () => {
    const real = path.join(dir, 'index.js');
    const link = path.join(dir, 'hygiene');
    await writeFile(real, '');
    try {
      await symlink(real, link, 'file');
    } catch {
      return; // sin permiso para crear enlaces en esta plataforma
    }
    expect(invokedDirectly(link, real)).toBe(true);
  });
});
