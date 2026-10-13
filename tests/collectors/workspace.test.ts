import { describe, it, expect } from 'vitest';
import type { FileEntry, GitFacts, ProjectCandidate } from '../../src/core/types.js';
import { countChildren, gitFor, gitKeyFor, isWorkspace, prefixGitFacts } from '../../src/collectors/workspace.js';

const facts = (tracked: string[] = []): GitFacts => ({
  isRepo: true, root: '/r', currentBranch: 'main', defaultBranch: 'main',
  trackedFiles: new Set(tracked), ignoredFiles: new Set(), dirtyFiles: new Set(), stashCount: 0,
});
const cand = (p: string, status: ProjectCandidate['status']): ProjectCandidate => ({ path: p, confidence: 0, markers: [], status });
const entry = (p: string): FileEntry => ({
  path: p, absPath: `/r/${p}`, isDir: false, isSymlink: false, size: 1, mtimeMs: 0, depth: 1, notDescended: false,
});

describe('workspace', () => {
  it('un root no-proyecto con un hijo proyecto es workspace', () => {
    expect(isWorkspace([cand('.', 'not-project'), cand('app', 'project')])).toBe(true);
    expect(isWorkspace([cand('.', 'project'), cand('app', 'project')])).toBe(false);
    expect(isWorkspace([cand('.', 'not-project'), cand('docs', 'not-project')])).toBe(false);
  });

  it('cuenta los hijos directos de cada directorio', () => {
    const c = countChildren([entry('a.txt'), entry('src'), entry('src/x.ts'), entry('src/y.ts')]);
    expect(c.get('.')).toBe(2);
    expect(c.get('src')).toBe(2);
    expect(c.get('vacio')).toBeUndefined();
  });

  it('gitFor elige el repo mas interior que contiene la ruta', () => {
    const byProject = { '.': facts(['a.txt']), app: facts(['app/x.ts']) };
    expect(gitKeyFor(byProject, 'a.txt')).toBe('.');
    expect(gitKeyFor(byProject, 'app/x.ts')).toBe('app');
    expect(gitKeyFor(byProject, 'appendix/x.ts')).toBe('.');
    expect(gitFor(byProject, 'app/x.ts')?.trackedFiles.has('app/x.ts')).toBe(true);
    expect(gitFor({}, 'a.txt')).toBeNull();
  });

  it('prefixGitFacts lleva las rutas al espacio del root auditado', () => {
    const g = prefixGitFacts({ ...facts(['x.ts']), ignoredDirs: new Set(['node_modules']) }, 'app');
    expect([...g.trackedFiles]).toEqual(['app/x.ts']);
    expect([...(g.ignoredDirs ?? [])]).toEqual(['app/node_modules']);
  });
});
