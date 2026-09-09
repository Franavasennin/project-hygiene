import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runAudit } from '../../src/audit.js';

const run = promisify(execFile);

const SECRETO = 'sk_live_ZQ7fN2kR8xW4pL6vB1mT9jY3';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'hyg-sec-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('los secretos no salen en claro', () => {
  it('el resultado serializado no contiene el valor del secreto', async () => {
    await writeFile(path.join(root, '.env'), `STRIPE_KEY=${SECRETO}\n`);

    const result = await runAudit({ root, rulesDir: path.join(process.cwd(), 'rules') });
    const serializado = JSON.stringify(result, (_k, v) => (v instanceof Set ? [...v] : v));

    expect(serializado).not.toContain(SECRETO);
    expect(serializado).not.toContain('sk_live_');
  });

  it('el secreto tampoco aparece cuando la regla examina el contenido del fichero', async () => {
    // SEC-ENTROPY-001 (rules/security.yml) usa `entropy_gt` sobre el contenido
    // del fichero y exige `tracked_by_git: true`. Para que la regla se
    // dispare de verdad (y no solo se ejercite el camino de metadatos que ya
    // cubre SEC-SECRET-001, que solo mira el nombre `.env`), este test
    // inicializa un repo git real en el directorio temporal y comitea el
    // fichero -- mismo patron que tests/collectors/git.test.ts.
    await run('git', ['init', '-b', 'main'], { cwd: root });
    await run('git', ['config', 'user.email', 't@t.t'], { cwd: root });
    await run('git', ['config', 'user.name', 'T'], { cwd: root });
    await writeFile(path.join(root, 'config.ts'), `export const KEY = "${SECRETO}";\n`);
    await run('git', ['add', 'config.ts'], { cwd: root });
    await run('git', ['commit', '-m', 'x'], { cwd: root });

    const result = await runAudit({ root, rulesDir: path.join(process.cwd(), 'rules') });
    const serializado = JSON.stringify(result, (_k, v) => (v instanceof Set ? [...v] : v));

    expect(serializado).not.toContain(SECRETO);

    // Confirma que la regla que lee contenido realmente se disparo -- si no,
    // el test de arriba no probaria lo que dice probar (podria pasar por
    // simple ausencia de findings).
    const findingIds = result.findings.map((f) => f.ruleId);
    expect(findingIds).toContain('SEC-ENTROPY-001');
  });

  it('una clave privada PEM no aparece en claro aunque dispare SEC-KEY-001', async () => {
    const clavePem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEAwv0RgtaGyC7cMv17mIsxi1MKA5eIfojLbnkzZ4E7q7HmMEZG',
      'ZdQ9k4kaVs4X9d3Z2sQ1YvB6nWtPqLxF2K8yTbXeR7RmSuAoWnCz1qLzXhVfM3sk',
      'FxWzBEsQyDpXwGkHnUvZaQmYcT5eNjRrKlWo9BsPfEiCgLd3AvXhJtNzKrYsMbTq',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');

    await run('git', ['init', '-b', 'main'], { cwd: root });
    await run('git', ['config', 'user.email', 't@t.t'], { cwd: root });
    await run('git', ['config', 'user.name', 'T'], { cwd: root });
    await writeFile(path.join(root, 'server.pem'), `${clavePem}\n`);
    await run('git', ['add', 'server.pem'], { cwd: root });
    await run('git', ['commit', '-m', 'x'], { cwd: root });

    const result = await runAudit({ root, rulesDir: path.join(process.cwd(), 'rules') });
    const serializado = JSON.stringify(result, (_k, v) => (v instanceof Set ? [...v] : v));

    // La clave no debe aparecer completa ni por ninguno de sus fragmentos
    // caracteristicos: la cabecera PEM y un tramo del cuerpo base64.
    expect(serializado).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(serializado).not.toContain('MIIEowIBAAKCAQEAwv0RgtaGyC7cMv17mIsxi1MKA5eIfojLbnkzZ4E7q7HmMEZG');

    const findingIds = result.findings.map((f) => f.ruleId);
    expect(findingIds).toContain('SEC-KEY-001');
  });

  it('evidence de cada finding solo contiene metadatos conocidos, nunca contenido', async () => {
    await writeFile(path.join(root, '.env'), `STRIPE_KEY=${SECRETO}\n`);
    const result = await runAudit({ root, rulesDir: path.join(process.cwd(), 'rules') });

    const CLAVES_PERMITIDAS = new Set(['size', 'mtimeMs', 'depth']);
    for (const finding of result.findings) {
      const claves = Object.keys(finding.evidence);
      for (const clave of claves) {
        expect(
          CLAVES_PERMITIDAS.has(clave),
          `Finding.evidence tiene una clave inesperada "${clave}" en la regla ${finding.ruleId}. ` +
            `Si se anadio un campo nuevo a evidence, confirma que NO contiene contenido de fichero ` +
            `(solo metadatos), y anade la clave a CLAVES_PERMITIDAS en este test si es segura.`,
        ).toBe(true);
      }
    }
  });
});
