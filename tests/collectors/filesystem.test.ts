import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { walk } from '../../src/collectors/filesystem.js';
import { Budget, DEFAULT_LIMITS } from '../../src/core/limits.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('walk', () => {
  it('registra node_modules sin descender', async () => {
    await mkdir(path.join(root, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'left-pad', 'i.js'), 'x');
    const r = await walk(root, new Budget(DEFAULT_LIMITS));
    const nm = r.files.find((f) => f.path === 'node_modules');
    expect(nm?.notDescended).toBe(true);
    expect(r.files.some((f) => f.path.startsWith('node_modules/'))).toBe(false);
  });

  it('marca truncated al superar el tope de ficheros', async () => {
    for (let i = 0; i < 5; i++) await writeFile(path.join(root, `f${i}.txt`), 'x');
    const r = await walk(root, new Budget({ ...DEFAULT_LIMITS, maxFilesScanned: 2 }));
    expect(r.truncated).toBe(true);
  });

  it('calcula profundidad y usa separador barra', async () => {
    await mkdir(path.join(root, 'a', 'b'), { recursive: true });
    await writeFile(path.join(root, 'a', 'b', 'c.txt'), 'x');
    const r = await walk(root, new Budget(DEFAULT_LIMITS));
    const c = r.files.find((f) => f.path === 'a/b/c.txt');
    expect(c?.depth).toBe(3);
  });
});
