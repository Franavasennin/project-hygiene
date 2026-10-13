import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  evalPredicate, RuleLimitError, UnsupportedPredicateError, type EvalContext, type WorkspaceFacts,
} from '../../src/engine/predicates.js';
import type { BranchFact, FileEntry, GitFacts, ProjectCandidate } from '../../src/core/types.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-12T00:00:00Z');

const entry = (p: string, extra: Partial<FileEntry> = {}): FileEntry => ({
  path: p, absPath: `/r/${p}`, isDir: false, isSymlink: false, size: 10,
  mtimeMs: NOW, depth: p === '.' ? 0 : p.split('/').length, notDescended: false, ...extra,
});
const cand = (p: string, status: ProjectCandidate['status']): ProjectCandidate => ({ path: p, confidence: 0, markers: [], status });

function ws(entries: FileEntry[], projects: ProjectCandidate[], rootIsWorkspace = false): WorkspaceFacts {
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.path === '.') continue;
    const i = e.path.lastIndexOf('/');
    const parent = i === -1 ? '.' : e.path.slice(0, i);
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  return { projects, rootIsWorkspace, childCounts: counts, entryAt: (p) => byPath.get(p) };
}

const git = (extra: Partial<GitFacts> = {}): GitFacts => ({
  isRepo: true, root: '/r', currentBranch: 'main', defaultBranch: 'main',
  trackedFiles: new Set(), ignoredFiles: new Set(), dirtyFiles: new Set(), stashCount: 0, ...extra,
});

const ctx = (e: FileEntry, extra: Partial<EvalContext> = {}): EvalContext => ({
  entry: e, git: null,
  content: { text: async () => null, hash: async () => null },
  duplicateHashes: new Set(), referencedPaths: new Set(), now: NOW, ...extra,
});

describe('predicados de fichero nuevos', () => {
  const projects = [cand('.', 'not-project'), cand('app', 'project')];
  const w = ws([entry('.', { isDir: true }), entry('app', { isDir: true }), entry('app/x.ts'), entry('nota.txt')], projects, true);

  it('in_project distingue lo que cae dentro de un proyecto', async () => {
    expect(await evalPredicate('in_project', true, ctx(entry('app/x.ts'), { workspace: w }))).toBe(true);
    expect(await evalPredicate('in_project', false, ctx(entry('nota.txt'), { workspace: w }))).toBe(true);
  });

  it('root_is_workspace lee el hecho del workspace', async () => {
    expect(await evalPredicate('root_is_workspace', true, ctx(entry('nota.txt'), { workspace: w }))).toBe(true);
    expect(await evalPredicate('root_is_workspace', true, ctx(entry('nota.txt')))).toBe(false);
  });

  it('in_git_repo depende de los hechos de git del contexto', async () => {
    expect(await evalPredicate('in_git_repo', true, ctx(entry('a'), { git: git() }))).toBe(true);
    expect(await evalPredicate('in_git_repo', false, ctx(entry('a')))).toBe(true);
  });

  it('ignored_by_git consulta los directorios ignorados para un directorio', async () => {
    const g = git({ ignoredDirs: new Set(['node_modules']) });
    expect(await evalPredicate('ignored_by_git', true, ctx(entry('node_modules', { isDir: true }), { git: g }))).toBe(true);
    expect(await evalPredicate('ignored_by_git', true, ctx(entry('dist', { isDir: true }), { git: g }))).toBe(false);
  });

  it('is_empty de un directorio cuenta hijos, no tamano', async () => {
    const w2 = ws([entry('vacio', { isDir: true, size: 4096 }), entry('lleno', { isDir: true }), entry('lleno/a')], []);
    expect(await evalPredicate('is_empty', true, ctx(entry('vacio', { isDir: true, size: 4096 }), { workspace: w2 }))).toBe(true);
    expect(await evalPredicate('is_empty', true, ctx(entry('lleno', { isDir: true }), { workspace: w2 }))).toBe(false);
  });

  it('mode_too_open mira grupo y otros en POSIX y es unsupported en Windows', async () => {
    expect(await evalPredicate('mode_too_open', true, ctx(entry('id_rsa', { mode: 0o100644 }), { platform: 'linux' }))).toBe(true);
    expect(await evalPredicate('mode_too_open', true, ctx(entry('id_rsa', { mode: 0o100600 }), { platform: 'linux' }))).toBe(false);
    await expect(evalPredicate('mode_too_open', true, ctx(entry('id_rsa'), { platform: 'win32' })))
      .rejects.toBeInstanceOf(UnsupportedPredicateError);
  });

  it('similar_to_readme_gt compara con el README del mismo directorio', async () => {
    const texto = 'este proyecto audita repositorios y propone operaciones reversibles con aprobacion humana';
    const readme = entry('README.md');
    const guia = entry('guia.md');
    const w3 = ws([readme, guia], []);
    const content = {
      text: async (e: FileEntry) => (e.path === 'README.md' ? texto : `# Guia\n${texto}`),
      hash: async () => null,
    };
    expect(await evalPredicate('similar_to_readme_gt', 0.8, ctx(guia, { workspace: w3, content }))).toBe(true);
    expect(await evalPredicate('similar_to_readme_gt', 0.8, ctx(readme, { workspace: w3, content }))).toBe(false);
  });
});

describe('predicados de proyecto', () => {
  const root = entry('.', { isDir: true });

  it('project_status compara con el estado del candidato', async () => {
    const w = ws([root, entry('app', { isDir: true })], [cand('.', 'not-project'), cand('app', 'unknown-boundary')]);
    expect(await evalPredicate('project_status', 'unknown-boundary', ctx(entry('app', { isDir: true }), { workspace: w }))).toBe(true);
    expect(await evalPredicate('project_status', 'project', ctx(root, { workspace: w }))).toBe(false);
  });

  it('has_child busca cualquiera de los nombres en el directorio del candidato', async () => {
    const w = ws([root, entry('package.json'), entry('app', { isDir: true }), entry('app/go.mod')], []);
    expect(await evalPredicate('has_child', ['Cargo.toml', 'package.json'], ctx(root, { workspace: w }))).toBe(true);
    expect(await evalPredicate('has_child', ['go.mod'], ctx(entry('app', { isDir: true }), { workspace: w }))).toBe(true);
    expect(await evalPredicate('has_child', ['.gitignore'], ctx(root, { workspace: w }))).toBe(false);
  });

  it('is_git_repo exige un directorio .git', async () => {
    const conDir = ws([root, entry('.git', { isDir: true })], []);
    const conFichero = ws([root, entry('.git')], []);
    expect(await evalPredicate('is_git_repo', true, ctx(root, { workspace: conDir }))).toBe(true);
    expect(await evalPredicate('is_git_repo', true, ctx(root, { workspace: conFichero }))).toBe(false);
  });

  describe('git_worktree_orphan', () => {
    let dir: string;
    beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'hyg-wt-')); });
    afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

    it('detecta un .git que apunta a un gitdir inexistente', async () => {
      const dotgit = entry('.git', { absPath: path.join(dir, '.git') });
      await writeFile(dotgit.absPath, 'gitdir: ./no/existe\n');
      const w = ws([root, dotgit], []);
      const content = { text: async () => 'gitdir: ./no/existe\n', hash: async () => null };
      expect(await evalPredicate('git_worktree_orphan', true, ctx(root, { workspace: w, content }))).toBe(true);
    });

    it('un gitdir existente no es huerfano', async () => {
      const dotgit = entry('.git', { absPath: path.join(dir, '.git') });
      const w = ws([root, dotgit], []);
      const content = { text: async () => `gitdir: ${dir}\n`, hash: async () => null };
      expect(await evalPredicate('git_worktree_orphan', true, ctx(root, { workspace: w, content }))).toBe(false);
    });
  });

  it('git_stash_older_than', async () => {
    const g = git({ stashTimesMs: [NOW - 40 * DAY] });
    expect(await evalPredicate('git_stash_older_than', '30d', ctx(root, { git: g }))).toBe(true);
    expect(await evalPredicate('git_stash_older_than', '60d', ctx(root, { git: g }))).toBe(false);
  });

  it('git_branch_stale y git_branch_orphaned', async () => {
    const branches: BranchFact[] = [
      { name: 'main', upstream: 'origin/main', lastCommitMs: NOW - 500 * DAY, merged: true },
      { name: 'fusionada', upstream: 'origin/fusionada', lastCommitMs: NOW - 200 * DAY, merged: true },
      { name: 'suelta', upstream: null, lastCommitMs: NOW - 200 * DAY, merged: false },
    ];
    const g = git({ branches });
    expect(await evalPredicate('git_branch_stale', '90d', ctx(root, { git: g }))).toBe(true);
    expect(await evalPredicate('git_branch_orphaned', '90d', ctx(root, { git: g }))).toBe(true);
    expect(await evalPredicate('git_branch_orphaned', '365d', ctx(root, { git: g }))).toBe(false);
    expect(await evalPredicate('git_branch_stale', '90d', ctx(root, { git: { ...g, defaultBranch: null } }))).toBe(false);
  });

  it('in_git_history con excepciones y tope', async () => {
    const spec = { paths: ['**/.env', '**/.env.*'], except: ['**/.env.example'] };
    const encontrado = git({ historyPaths: new Set(['config/.env']), historyTruncated: false });
    const soloEjemplo = git({ historyPaths: new Set(['.env.example']), historyTruncated: false });
    const truncado = git({ historyPaths: new Set(['a.ts']), historyTruncated: true });
    expect(await evalPredicate('in_git_history', spec, ctx(root, { git: encontrado }))).toBe(true);
    expect(await evalPredicate('in_git_history', spec, ctx(root, { git: soloEjemplo }))).toBe(false);
    await expect(evalPredicate('in_git_history', spec, ctx(root, { git: truncado }))).rejects.toBeInstanceOf(RuleLimitError);
  });
});
