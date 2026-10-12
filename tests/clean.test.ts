import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, utimes, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runClean } from '../src/clean.js';
import { runPlan } from '../src/plan.js';
import { selectOperations, mergeApproval } from '../src/approvals/approve.js';
import { loadApprovals, saveApprovals } from '../src/approvals/store.js';

const RULES = path.join(process.cwd(), 'rules');
const existe = (p: string) => access(p).then(() => true, () => false);

let base: string;
let root: string;
let home: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-cl-'));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  await mkdir(root);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

// Contenidos distintos: dos logs iguales dispararian FS-DUP-001 y el
// conflicto de sugerencias los degradaria a review.
async function logViejo(rel: string, contenido: string): Promise<void> {
  const p = path.join(root, rel);
  await writeFile(p, contenido);
  const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  await utimes(p, viejo, viejo);
}

async function aprobarTodo(): Promise<void> {
  const { plan } = await runPlan({ root, rulesDir: RULES });
  const { selected } = selectOperations({ plan, ids: [], risk: 'high' });
  await saveApprovals(home, mergeApproval(null, plan, selected, ['--risk', 'high'], new Date()));
}

describe('runClean', () => {
  it('sin aprobaciones no hace nada', async () => {
    await logViejo('debug.log', 'a');
    expect(await runClean({ root, rulesDir: RULES, home })).toEqual({ status: 'no-approvals' });
    expect(await existe(path.join(root, 'debug.log'))).toBe(true);
  });

  it('ejecuta lo aprobado y consume la aprobacion', async () => {
    await logViejo('debug.log', 'a');
    await aprobarTodo();

    const r = await runClean({ root, rulesDir: RULES, home });
    expect(r.status).toBe('executed');
    if (r.status !== 'executed') return;
    expect(r.outcomes.map((o) => o.status)).toEqual(['quarantined']);
    expect(await existe(path.join(root, 'debug.log'))).toBe(false);
    expect(await loadApprovals(home, root)).toBeNull();
  });

  it('una aprobacion que ya no coincide con el disco bloquea todo', async () => {
    await logViejo('a.log', 'a');
    await logViejo('b.log', 'b');
    await aprobarTodo();
    await logViejo('b.log', 'b cambiado');

    const r = await runClean({ root, rulesDir: RULES, home });
    expect(r.status).toBe('stale');
    if (r.status !== 'stale') return;
    expect(r.stale.map((a) => a.path)).toEqual(['b.log']);
    expect(await existe(path.join(root, 'a.log'))).toBe(true);
    expect(await existe(path.join(root, 'b.log'))).toBe(true);
    expect(await loadApprovals(home, root)).not.toBeNull();
  });
});
