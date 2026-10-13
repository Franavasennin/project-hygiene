import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, utimes, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runLoop } from '../src/loop.js';
import { DEFAULT_LOOP, type HygieneConfig } from '../src/config/load.js';

const RULES = path.join(process.cwd(), 'rules');
const existe = (p: string) => access(p).then(() => true, () => false);
let base: string;
let root: string;
let home: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-loop-'));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  await mkdir(root);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

async function logViejo(rel: string, contenido: string): Promise<void> {
  const p = path.join(root, rel);
  await writeFile(p, contenido);
  const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  await utimes(p, viejo, viejo);
}
const config = (extra: Partial<HygieneConfig['loop']> = {}): HygieneConfig => ({ limits: {}, loop: { ...DEFAULT_LOOP, ...extra } });

describe('runLoop', () => {
  it('ejecuta por politica lo seguro, reaudita y para cuando no queda nada', async () => {
    await logViejo('a.log', 'a');
    await logViejo('b.log', 'b');
    const r = await runLoop({ root, rulesDir: RULES, home, config: config() });
    expect(r.iterations).toHaveLength(1);
    expect(r.iterations[0]).toMatchObject({ n: 1, executed: 2 });
    expect(r.scoreFinal).toBeGreaterThan(r.scoreInitial);
    expect(r.stop).toBe('no-operations');
    expect(await existe(path.join(root, 'a.log'))).toBe(false);
  });

  it('si la politica exige aprobacion para todo, no mueve nada', async () => {
    await logViejo('a.log', 'a');
    const r = await runLoop({
      root, rulesDir: RULES, home,
      config: config({ requireApprovalForRisk: ['safe', 'low', 'medium', 'high', 'unknown'] }),
    });
    expect(r).toMatchObject({ iterations: [], stop: 'no-operations' });
    expect(await existe(path.join(root, 'a.log'))).toBe(true);
  });

  it('respeta max_iterations', async () => {
    await logViejo('a.log', 'a');
    const r = await runLoop({ root, rulesDir: RULES, home, config: config({ maxIterations: 1, stopIfNoImprovement: false }) });
    expect(r.iterations.length).toBeLessThanOrEqual(1);
  });
});
