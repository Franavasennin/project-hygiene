import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadPacks } from '../../src/rules/schema.js';
import { evaluateRule } from '../../src/engine/evaluate.js';
import type { EvalContext } from '../../src/engine/predicates.js';
import type { FileEntry, GitFacts } from '../../src/core/types.js';

const RULES = path.join(process.cwd(), 'rules');

const mkEntry = (p: string): FileEntry => ({
  path: p, absPath: `/tmp/${p}`, isDir: false, isSymlink: false,
  size: 10, mtimeMs: Date.now(), depth: 1, notDescended: false,
});

const gitFactsTrackeado = (path: string): GitFacts => ({
  isRepo: true, root: '/tmp', currentBranch: 'main', defaultBranch: 'main',
  trackedFiles: new Set([path]), ignoredFiles: new Set(), dirtyFiles: new Set(),
  stashCount: 0,
});

const ctxFor = (entry: FileEntry): EvalContext => ({
  entry, git: null,
  content: { text: async () => null, hash: async () => null },
  duplicateHashes: new Set(), referencedPaths: new Set(), now: Date.now(),
});

describe('packs de la v1', () => {
  it('los cuatro packs validan contra el schema', async () => {
    const packs = await loadPacks(RULES);
    expect(packs.map((p) => p.axis).sort()).toEqual(['ai', 'filesystem', 'git', 'security']);
  });

  it('ningun id de regla se repite entre packs', async () => {
    const packs = await loadPacks(RULES);
    const ids = packs.flatMap((p) => p.rules.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('toda regla critica es del eje de seguridad', async () => {
    const packs = await loadPacks(RULES);
    for (const p of packs) {
      for (const r of p.rules) {
        if (r.severity === 'critical') expect(p.axis).toBe('security');
      }
    }
  });

  it('AI-SCRIPT-001 no marca ficheros de configuracion de herramientas comunes', async () => {
    const packs = await loadPacks(RULES);
    const regla = packs.flatMap((p) => p.rules).find((r) => r.id === 'AI-SCRIPT-001')!;
    for (const nombre of ['eslint.config.mjs', 'vite.config.mjs', 'manage.py']) {
      expect(await evaluateRule(regla, ctxFor(mkEntry(nombre)))).toBe(false);
    }
  });

  it('FS-NAMING-001 no marca nombres de version de API intencionales', async () => {
    const packs = await loadPacks(RULES);
    const regla = packs.flatMap((p) => p.rules).find((r) => r.id === 'FS-NAMING-001')!;
    expect(await evaluateRule(regla, ctxFor(mkEntry('client-v2.ts')))).toBe(false);
    expect(await evaluateRule(regla, ctxFor(mkEntry('debug-final.ts')))).toBe(true);
  });

  it('SEC-ENTROPY-001 no dispara sobre un pack de reglas legitimo, pero si sobre un YAML cualquiera con el mismo contenido', async () => {
    const packs = await loadPacks(RULES);
    const regla = packs.flatMap((p) => p.rules).find((r) => r.id === 'SEC-ENTROPY-001')!;

    const contenidoConRegexComplejo = [
      'schema_version: 1',
      'pack_id: hygiene.test.pack',
      'version: 1.0.0',
      'axis: filesystem',
      'rules:',
      '  - id: FS-NAMING-001',
      "    match: { basename_regex: '(?i)[-_ ](final|v[0-9]+|copy|backup|old|prueba|temp)[0-9]*(\\\\.[^.]+)?$' }",
    ].join('\n');

    const path1 = 'rules/mi-pack.yml';
    const ctx1: EvalContext = {
      entry: mkEntry(path1),
      git: gitFactsTrackeado(path1),
      content: { text: async () => contenidoConRegexComplejo, hash: async () => null },
      duplicateHashes: new Set(), referencedPaths: new Set(), now: Date.now(),
    };
    expect(await evaluateRule(regla, ctx1)).toBe(false);

    const path2 = 'config/otro.yml';
    const ctx2: EvalContext = {
      entry: mkEntry(path2),
      git: gitFactsTrackeado(path2),
      content: { text: async () => contenidoConRegexComplejo.replace('pack_id: hygiene.test.pack', 'algo: distinto'), hash: async () => null },
      duplicateHashes: new Set(), referencedPaths: new Set(), now: Date.now(),
    };
    expect(await evaluateRule(regla, ctx2)).toBe(true);
  });
});
