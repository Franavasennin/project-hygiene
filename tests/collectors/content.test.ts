import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { shannonEntropy, looksBinary, createContentCache } from '../../src/collectors/content.js';
import { Budget, DEFAULT_LIMITS } from '../../src/core/limits.js';
import { mkdtemp, writeFile, symlink, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FileEntry } from '../../src/core/types.js';

describe('content', () => {
  it('da entropia baja a texto repetido', () => {
    expect(shannonEntropy('aaaaaaaaaaaaaaaa')).toBeLessThan(1);
  });

  it('da entropia alta a una cadena aleatoria', () => {
    expect(shannonEntropy('kJ8fQ2xZ7pR4vN1mB6tL9wY3')).toBeGreaterThan(4);
  });

  it('detecta binario por byte nulo', () => {
    expect(looksBinary(Buffer.from([0x41, 0x00, 0x42]))).toBe(true);
    expect(looksBinary(Buffer.from('hola', 'utf8'))).toBe(false);
  });
});

describe('createContentCache con symlinks', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-content-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('no lee el contenido de un fichero symlink', async () => {
    const objetivo = path.join(root, 'objetivo.txt');
    await writeFile(objetivo, 'contenido secreto del objetivo');
    const enlace = path.join(root, 'enlace.txt');
    await symlink(objetivo, enlace);
    const st = await lstat(enlace);

    const entry: FileEntry = {
      path: 'enlace.txt', absPath: enlace, isDir: false, isSymlink: true,
      size: st.size, mtimeMs: st.mtimeMs, depth: 1, notDescended: false,
    };

    const cache = createContentCache(new Budget(DEFAULT_LIMITS));
    const texto = await cache.text(entry);
    expect(texto).toBeNull();
  });
});
