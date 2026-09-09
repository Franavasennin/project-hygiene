import { describe, it, expect } from 'vitest';
import { evaluateRule } from '../../src/engine/evaluate.js';
import type { Rule } from '../../src/rules/schema.js';
import type { EvalContext } from '../../src/engine/predicates.js';
import type { FileEntry } from '../../src/core/types.js';

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
