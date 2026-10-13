import { describe, it, expect } from 'vitest';
import { evaluateAll } from '../../src/engine/evaluate.js';
import { Budget, DEFAULT_LIMITS } from '../../src/core/limits.js';
import type { EvalContext } from '../../src/engine/predicates.js';
import type { FileEntry, GitFacts, Inventory } from '../../src/core/types.js';
import type { Pack, Rule } from '../../src/rules/schema.js';

const entry = (p: string, isDir = false): FileEntry => ({
  path: p, absPath: `/r/${p}`, isDir, isSymlink: false, size: 1, mtimeMs: 0, depth: 1, notDescended: false,
});
const rule = (extra: Partial<Rule>): Rule => ({
  id: 'GIT-TEST-001', title: 't', why: 'w', severity: 'low', risk: 'low', confidence: 0.5,
  match: { is_dir: true }, suggests: [{ type: 'review' }], ...extra,
});
const packOf = (r: Rule): Pack => ({ schema_version: 1, pack_id: 'p', version: '1.0.0', axis: 'git', rules: [r] });
const inventory: Inventory = {
  root: '/r', scannedAt: '', truncated: false,
  files: [entry('src', true), entry('a.ts')], projects: [], gitByProject: {},
};
const git: GitFacts = {
  isRepo: true, root: '/r', currentBranch: 'main', defaultBranch: 'main', trackedFiles: new Set(),
  ignoredFiles: new Set(), dirtyFiles: new Set(), stashCount: 0,
  historyPaths: new Set(['a.ts']), historyTruncated: true,
};
const makeContext = (platform: NodeJS.Platform = 'linux') => (p: string): EvalContext => ({
  entry: p === '.' ? entry('.', true) : inventory.files.find((f) => f.path === p) ?? entry(p),
  git, content: { text: async () => null, hash: async () => null },
  duplicateHashes: new Set(), referencedPaths: new Set(), now: 0, platform,
});

describe('evaluateAll con scope', () => {
  it('una regla de proyecto solo ve las entradas de proyecto', async () => {
    const out = await evaluateAll({
      inventory, packs: [packOf(rule({ scope: 'project' }))], budget: new Budget(DEFAULT_LIMITS),
      makeContext: makeContext(), projectEntries: [entry('.', true)],
    });
    expect(out.findings.map((f) => f.path)).toEqual(['.']);
  });

  it('una regla de fichero sigue viendo el inventario', async () => {
    const out = await evaluateAll({
      inventory, packs: [packOf(rule({}))], budget: new Budget(DEFAULT_LIMITS),
      makeContext: makeContext(), projectEntries: [entry('.', true)],
    });
    expect(out.findings.map((f) => f.path)).toEqual(['src']);
  });

  it('un RuleLimitError se registra una vez como limite y no produce hallazgo', async () => {
    const r = rule({ scope: 'project', match: { in_git_history: { paths: ['**/.env'] } } });
    const out = await evaluateAll({
      inventory, packs: [packOf(r)], budget: new Budget(DEFAULT_LIMITS),
      makeContext: makeContext(), projectEntries: [entry('.', true), entry('src', true)],
    });
    expect(out.findings).toEqual([]);
    expect(out.limits).toEqual([{ ruleId: 'GIT-TEST-001', limit: 'max_git_history_commits' }]);
  });

  it('un predicado no soportado se reporta como unsupported y corta la regla', async () => {
    const r = rule({ match: { mode_too_open: true } });
    const out = await evaluateAll({
      inventory, packs: [packOf(r)], budget: new Budget(DEFAULT_LIMITS), makeContext: makeContext('win32'),
    });
    expect(out.findings).toEqual([]);
    expect(out.unsupported).toEqual([{ ruleId: 'GIT-TEST-001', reason: 'los permisos POSIX no existen en Windows' }]);
    expect(out.limits).toEqual([]);
  });
});
