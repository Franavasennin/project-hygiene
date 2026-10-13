import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runPlan } from '../../src/plan.js';

const RULES = path.join(process.cwd(), 'rules');
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-plan-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function logViejo(nombre: string, contenido: string): Promise<void> {
  const p = path.join(root, nombre);
  await writeFile(p, contenido);
  const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  await utimes(p, viejo, viejo);
}

describe('runPlan', () => {
  it('propone cuarentena para un log abandonado, con la huella real del fichero', async () => {
    await logViejo('debug.log', 'contenido del log');
    const { plan } = await runPlan({ root, rulesDir: RULES });
    const op = plan.operations.find((o) => o.path === 'debug.log');
    expect(op?.type).toBe('quarantine');
    expect(op?.id).toBe('OP-000001');
    expect(op?.source.sha256).toBe(createHash('sha256').update('contenido del log').digest('hex'));
    expect(op?.source.size).toBe(Buffer.byteLength('contenido del log'));
  });

  it('degrada a review si algun fichero fuente referencia el log', async () => {
    await logViejo('debug.log', 'x');
    await writeFile(path.join(root, 'README.md'), 'Los errores van a debug.log');
    const { plan } = await runPlan({ root, rulesDir: RULES });
    const op = plan.operations.find((o) => o.path === 'debug.log');
    expect(op?.type).toBe('review');
    expect(op?.degradeReason).toBe('referenced-by-source');
  });

  it('propone ignore para un node_modules sin ignorar en un repo', async () => {
    await promisify(execFile)('git', ['init', '-q', '-b', 'main'], { cwd: root });
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'node_modules', 'a.js'), 'x');
    const { plan } = await runPlan({ root, rulesDir: RULES });
    expect(plan.operations.find((o) => o.path === 'node_modules')).toMatchObject({
      type: 'ignore', edit: { file: '.gitignore', line: '/node_modules/' }, source: { sha256: 'absent' },
    });
  });

  it('el mismo estado de disco produce el mismo plan', async () => {
    await logViejo('debug.log', 'x');
    const a = await runPlan({ root, rulesDir: RULES });
    const b = await runPlan({ root, rulesDir: RULES });
    expect(a.plan.planId).toBe(b.plan.planId);
    expect(a.plan.operations).toEqual(b.plan.operations);
  });
});
