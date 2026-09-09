import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAudit } from '../src/audit.js';

const RULES = path.join(process.cwd(), 'rules');
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('runAudit', () => {
  it('encuentra un log antiguo y baja la puntuacion', async () => {
    const p = path.join(root, 'debug.log');
    await writeFile(p, 'x');
    const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    await utimes(p, viejo, viejo);

    const result = await runAudit({ root, rulesDir: RULES });
    expect(result.findings.some((f) => f.ruleId === 'FS-TEMP-001')).toBe(true);
    expect(result.score.total).toBeLessThan(100);
  });

  it('un arbol vacio puntua 100 y limpio', async () => {
    const result = await runAudit({ root, rulesDir: RULES });
    expect(result.score.total).toBe(100);
    expect(result.score.clean).toBe(true);
  });
});
