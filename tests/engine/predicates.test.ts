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

  it('path_regex casa contra la ruta completa', async () => {
    expect(await evalPredicate('path_regex', '^src/', ctx())).toBe(true);
    expect(await evalPredicate('path_regex', '^lib/', ctx())).toBe(false);
  });

  it('depth_gt compara estrictamente mayor', async () => {
    expect(await evalPredicate('depth_gt', 1, ctx())).toBe(true);
    expect(await evalPredicate('depth_gt', 2, ctx())).toBe(false);
    expect(await evalPredicate('depth_gt', 3, ctx())).toBe(false);
  });

  it('is_file distingue fichero de directorio', async () => {
    expect(await evalPredicate('is_file', true, ctx())).toBe(true);
    expect(await evalPredicate('is_file', false, ctx())).toBe(false);
    const dir = ctx({ entry: { ...entry, isDir: true } });
    expect(await evalPredicate('is_file', true, dir)).toBe(false);
    expect(await evalPredicate('is_file', false, dir)).toBe(true);
  });

  it('is_dir distingue directorio de fichero', async () => {
    expect(await evalPredicate('is_dir', false, ctx())).toBe(true);
    const dir = ctx({ entry: { ...entry, isDir: true } });
    expect(await evalPredicate('is_dir', true, dir)).toBe(true);
  });

  it('is_symlink refleja el flag del entry', async () => {
    expect(await evalPredicate('is_symlink', false, ctx())).toBe(true);
    const link = ctx({ entry: { ...entry, isSymlink: true } });
    expect(await evalPredicate('is_symlink', true, link)).toBe(true);
  });

  it('is_empty compara el tamano con cero', async () => {
    expect(await evalPredicate('is_empty', false, ctx())).toBe(true);
    const vacio = ctx({ entry: { ...entry, size: 0 } });
    expect(await evalPredicate('is_empty', true, vacio)).toBe(true);
  });

  it('size_gt y size_lt comparan estrictamente', async () => {
    expect(await evalPredicate('size_gt', 100, ctx())).toBe(true);
    expect(await evalPredicate('size_gt', 120, ctx())).toBe(false);
    expect(await evalPredicate('size_lt', 200, ctx())).toBe(true);
    expect(await evalPredicate('size_lt', 120, ctx())).toBe(false);
  });

  it('newer_than es la negacion temporal de older_than', async () => {
    expect(await evalPredicate('newer_than', '365d', ctx())).toBe(true);
    expect(await evalPredicate('newer_than', '30d', ctx())).toBe(false);
  });

  it('ignored_by_git es false sin repositorio', async () => {
    expect(await evalPredicate('ignored_by_git', true, ctx())).toBe(false);
    expect(await evalPredicate('ignored_by_git', false, ctx())).toBe(true);
  });

  it('git_status distingue dirty de clean con datos reales de git', async () => {
    const gitFacts = {
      isRepo: true,
      root: '/tmp/x',
      currentBranch: 'main',
      defaultBranch: 'main',
      trackedFiles: new Set<string>(),
      ignoredFiles: new Set<string>(),
      dirtyFiles: new Set(['src/debug-final.ts']),
      stashCount: 0,
    };
    const sucio = ctx({ git: gitFacts });
    expect(await evalPredicate('git_status', 'dirty', sucio)).toBe(true);
    expect(await evalPredicate('git_status', 'clean', sucio)).toBe(false);
  });

  it('content_matches busca el patron en el texto del fichero', async () => {
    expect(await evalPredicate('content_matches', 'hola', ctx())).toBe(true);
    expect(await evalPredicate('content_matches', 'adios', ctx())).toBe(false);
  });

  it('sha256_duplicate consulta el set de hashes duplicados', async () => {
    const conDuplicado = ctx({ duplicateHashes: new Set(['abc']) });
    expect(await evalPredicate('sha256_duplicate', true, conDuplicado)).toBe(true);
    expect(await evalPredicate('sha256_duplicate', true, ctx())).toBe(false);
  });

  it('referenced_by_source consulta el set de rutas referenciadas', async () => {
    const referenciado = ctx({ referencedPaths: new Set(['src/debug-final.ts']) });
    expect(await evalPredicate('referenced_by_source', true, referenciado)).toBe(true);
    expect(await evalPredicate('referenced_by_source', true, ctx())).toBe(false);
  });
});
