import { describe, it, expect } from 'vitest';
import { evalPredicate, type EvalContext } from '../../src/engine/predicates.js';
import type { FileEntry } from '../../src/core/types.js';

const entry: FileEntry = {
  path: 'src/debug-final.ts',
  absPath: '/tmp/x/src/debug-final.ts',
  isDir: false,
  isSymlink: false,
  size: 120,
  mtimeMs: Date.now() - 100 * 24 * 3600 * 1000,
  depth: 2,
  notDescended: false,
};

const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  entry,
  git: null,
  content: { text: async () => 'hola', hash: async () => 'abc' },
  duplicateHashes: new Set(),
  referencedPaths: new Set(),
  now: Date.now(),
  ...over,
});

describe('evalPredicate', () => {
  it('glob casa por ruta', async () => {
    expect(await evalPredicate('glob', '**/*.ts', ctx())).toBe(true);
    expect(await evalPredicate('glob', '**/*.md', ctx())).toBe(false);
  });

  it('basename_regex casa solo con el nombre', async () => {
    expect(await evalPredicate('basename_regex', '(?i)-final', ctx())).toBe(true);
    expect(await evalPredicate('basename_regex', '^src', ctx())).toBe(false);
  });

  it('older_than compara contra now', async () => {
    expect(await evalPredicate('older_than', '30d', ctx())).toBe(true);
    expect(await evalPredicate('older_than', '365d', ctx())).toBe(false);
  });

  it('tracked_by_git es false sin repositorio', async () => {
    expect(await evalPredicate('tracked_by_git', true, ctx())).toBe(false);
  });

  it('entropy_gt usa el texto del fichero', async () => {
    const alto = ctx({
      content: { text: async () => 'kJ8fQ2xZ7pR4vN1mB6tL9wY3', hash: async () => null },
    });
    expect(await evalPredicate('entropy_gt', 4, alto)).toBe(true);
    expect(await evalPredicate('entropy_gt', 4, ctx())).toBe(false);
  });

  it('un predicado desconocido lanza error', async () => {
    await expect(evalPredicate('inventado', true, ctx())).rejects.toThrow();
  });
});
