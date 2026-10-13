import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cp, mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { runAudit } from '../../src/audit.js';

// Las reglas con older_than dependen del mtime. Se audita una copia con las
// fechas puestas a ahora (en Windows cp conserva el mtime original), asi el
// fixture queda "recien clonado" y el snapshot no caduca con los dias.
let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'hyg-golden-'));
  await cp(path.join(process.cwd(), 'examples', 'before'), root, { recursive: true });
  const ahora = new Date();
  for (const rel of await readdir(root, { recursive: true })) {
    await utimes(path.join(root, rel), ahora, ahora);
  }
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('fixture dorado', () => {
  it('detecta el conjunto esperado de reglas', async () => {
    const result = await runAudit({ root, rulesDir: path.join(process.cwd(), 'rules') });

    const reglas = [...new Set(result.findings.map((f) => f.ruleId))].sort();
    expect(reglas).toMatchSnapshot();
  });

  it('clasifica proyecto-a como proyecto', async () => {
    const result = await runAudit({ root, rulesDir: path.join(process.cwd(), 'rules') });
    const a = result.inventory.projects.find((p) => p.path === 'proyecto-a');
    expect(a?.status).toBe('project');
  });
});

describe('fixture dorado after', () => {
  let after: string;
  beforeAll(async () => {
    after = await mkdtemp(path.join(tmpdir(), 'hyg-golden-after-'));
    await cp(path.join(process.cwd(), 'examples', 'after'), after, { recursive: true });
    const ahora = new Date();
    for (const rel of await readdir(after, { recursive: true })) {
      await utimes(path.join(after, rel), ahora, ahora);
    }
    // Un repo no se puede versionar dentro de otro: se crea en la copia.
    await promisify(execFile)('git', ['init', '-q'], { cwd: path.join(after, 'proyecto-a') });
  });
  afterAll(async () => { await rm(after, { recursive: true, force: true }); });

  it('el estado objetivo audita limpio y sin hallazgos', async () => {
    const result = await runAudit({ root: after, rulesDir: path.join(process.cwd(), 'rules') });
    expect(result.findings.map((f) => `${f.ruleId} ${f.path}`)).toEqual([]);
    expect(result.score.clean).toBe(true);
  });
});
