import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadPacks } from '../../src/rules/schema.js';
import { evaluateRule } from '../../src/engine/evaluate.js';
import type { EvalContext } from '../../src/engine/predicates.js';
import type { FileEntry } from '../../src/core/types.js';

const RULES = path.join(process.cwd(), 'rules');

const mkEntry = (p: string): FileEntry => ({
  path: p, absPath: `/tmp/${p}`, isDir: false, isSymlink: false,
  size: 10, mtimeMs: Date.now(), depth: 1, notDescended: false,
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
});
