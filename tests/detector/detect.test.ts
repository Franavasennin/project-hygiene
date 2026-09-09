// tests/detector/detect.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detectProjects } from '../../src/detector/detect.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const touch = async (p: string) => {
  await mkdir(path.dirname(path.join(root, p)), { recursive: true });
  await writeFile(path.join(root, p), '');
};

describe('detectProjects', () => {
  it('un directorio con .git es proyecto', async () => {
    await mkdir(path.join(root, 'a', '.git'), { recursive: true });
    const found = await detectProjects(root);
    const a = found.find((p) => p.path === 'a');
    expect(a?.status).toBe('project');
    expect(a?.confidence).toBeCloseTo(0.8);
  });

  it('solo package.json queda como frontera desconocida', async () => {
    await touch('b/package.json');
    const b = (await detectProjects(root)).find((p) => p.path === 'b');
    expect(b?.status).toBe('unknown-boundary');
  });

  it('manifiesto mas src, tests y README llega a proyecto', async () => {
    await touch('c/package.json');
    await touch('c/src/index.ts');
    await touch('c/tests/a.test.ts');
    await touch('c/README.md');
    const c = (await detectProjects(root)).find((p) => p.path === 'c');
    expect(c?.status).toBe('project');
  });

  it('un manifiesto en la raiz no absorbe a los hijos', async () => {
    await touch('package.json');
    await mkdir(path.join(root, 'hijo', '.git'), { recursive: true });
    const found = await detectProjects(root);
    expect(found.find((p) => p.path === 'hijo')?.status).toBe('project');
  });
});
