import { describe, it, expect } from 'vitest';
import { evaluateRule, evaluateAll, MalformedMatchNodeError } from '../../src/engine/evaluate.js';
import { Budget, DEFAULT_LIMITS } from '../../src/core/limits.js';
import type { Pack, Rule } from '../../src/rules/schema.js';
import type { EvalContext } from '../../src/engine/predicates.js';
import type { FileEntry, Inventory } from '../../src/core/types.js';

const mk = (p: string): FileEntry => ({
  path: p, absPath: `/tmp/${p}`, isDir: false, isSymlink: false,
  size: 10, mtimeMs: Date.now(), depth: 1, notDescended: false,
});

const ctxFor = (entry: FileEntry): EvalContext => ({
  entry, git: null,
  content: { text: async () => null, hash: async () => null },
  duplicateHashes: new Set(), referencedPaths: new Set(), now: Date.now(),
});

const rule: Rule = {
  id: 'FS-TEMP-001',
  title: 'Log abandonado',
  why: 'Artefacto generado.',
  severity: 'low', risk: 'safe', confidence: 0.9,
  match: { all: [{ glob: '**/*.log' }, { none: [{ glob: 'keep/**' }] }] },
  suggests: [{ type: 'review' }],
};

describe('evaluateRule', () => {
  it('casa un log suelto', async () => {
    expect(await evaluateRule(rule, ctxFor(mk('debug.log')))).toBe(true);
  });

  it('none excluye la carpeta protegida', async () => {
    expect(await evaluateRule(rule, ctxFor(mk('keep/debug.log')))).toBe(false);
  });

  it('any exige al menos una rama', async () => {
    const r: Rule = { ...rule, match: { any: [{ glob: '**/*.tmp' }, { glob: '**/*.log' }] } };
    expect(await evaluateRule(r, ctxFor(mk('a.tmp')))).toBe(true);
    expect(await evaluateRule(r, ctxFor(mk('a.md')))).toBe(false);
  });
});

describe('evaluateRule casos adicionales', () => {
  it('un combinador none vacio es vacuously true', async () => {
    const r: Rule = { ...rule, match: { none: [] } };
    expect(await evaluateRule(r, ctxFor(mk('cualquiera.log')))).toBe(true);
  });

  it('un match vacio {} es vacuously true', async () => {
    const r: Rule = { ...rule, match: {} };
    expect(await evaluateRule(r, ctxFor(mk('cualquiera.log')))).toBe(true);
  });

  it('un nodo con mas de una clave lanza MalformedMatchNodeError', async () => {
    const r: Rule = { ...rule, match: { glob: '**/*.log', is_file: true } as never };
    await expect(evaluateRule(r, ctxFor(mk('a.log')))).rejects.toThrow(MalformedMatchNodeError);
  });
});

describe('evaluateAll', () => {
  const mkInventory = (paths: string[]): Inventory => ({
    root: '/tmp',
    scannedAt: new Date().toISOString(),
    truncated: false,
    files: paths.map((p) => mk(p)),
    projects: [],
    gitByProject: {},
  });

  const mkPack = (r: Rule): Pack => ({
    schema_version: 1,
    pack_id: 'test.pack',
    version: '1.0.0',
    axis: 'filesystem',
    rules: [r],
  });

  it('respeta maxRuleMatches y lo anota tanto en limits como en budget.hits()', async () => {
    const budget = new Budget({ ...DEFAULT_LIMITS, maxRuleMatches: 2 });
    const inventory = mkInventory(['a.log', 'b.log', 'c.log', 'd.log']);
    const packs = [mkPack(rule)];

    const result = await evaluateAll({
      inventory, packs, budget,
      makeContext: (p) => ctxFor(mk(p)),
    });

    expect(result.findings).toHaveLength(2);
    expect(result.limits.some((l) => l.limit === 'max_rule_matches')).toBe(true);
    expect(budget.hits()).toContain('maxRuleMatches');
  });

  it('el timeout total detiene el recorrido sin generar entradas duplicadas por regla', async () => {
    const budget = new Budget({ ...DEFAULT_LIMITS, timeoutMsTotal: 0 });
    const inventory = mkInventory(['a.log']);
    const reglaB: Rule = { ...rule, id: 'FS-TEMP-002' };
    const packs = [mkPack(rule), mkPack(reglaB)];

    const result = await evaluateAll({
      inventory, packs, budget,
      makeContext: (p) => ctxFor(mk(p)),
    });

    const timeouts = result.limits.filter((l) => l.limit === 'timeout_ms_total');
    expect(timeouts.length).toBeLessThanOrEqual(1);
  });
});
