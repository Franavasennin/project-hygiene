import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadPacks } from '../../src/rules/schema.js';

const RULES = path.join(process.cwd(), 'rules');

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
});
