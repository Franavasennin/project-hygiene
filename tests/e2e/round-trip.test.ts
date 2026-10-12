import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes, chmod, stat, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../../src/cli/index.js';
import { findEntries } from '../../src/executor/manifest.js';

const posix = process.platform !== 'win32';
const existe = (p: string) => access(p).then(() => true, () => false);
const sha = async (p: string) => createHash('sha256').update(await readFile(p)).digest('hex');

let base: string;
let root: string;
let home: string;
let salida: string[];
const print = (s: string) => { salida.push(s); };
const homePrevio = process.env.HYGIENE_HOME;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'hyg-e2e-'));
  root = path.join(base, 'ws');
  home = path.join(base, 'home');
  await mkdir(root);
  process.env.HYGIENE_HOME = home;
  salida = [];
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  if (homePrevio === undefined) delete process.env.HYGIENE_HOME;
  else process.env.HYGIENE_HOME = homePrevio;
});

async function logViejo(rel: string, contenido: string): Promise<string> {
  const abs = path.join(root, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, contenido);
  const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  await utimes(abs, viejo, viejo);
  return abs;
}

describe('ida y vuelta completa por la CLI', () => {
  it('plan, approve, clean y restore devuelven cada fichero con hash, ruta y permisos', async () => {
    const a = await logViejo('debug.log', 'primer log');
    const b = await logViejo('logs/servidor.log', 'segundo log');
    if (posix) await chmod(b, 0o640);
    const antes = { a: await sha(a), b: await sha(b) };

    await main(['plan', root, '--json'], print);
    const plan = JSON.parse(salida.join('\n')) as { operations: { id: string; type: string; path: string }[] };
    const cuarentenas = plan.operations.filter((o) => o.type === 'quarantine');
    expect(cuarentenas.map((o) => o.path)).toEqual(['debug.log', 'logs/servidor.log']);

    expect(await main(['approve', '--risk', 'safe', '--root', root], print)).toBe(0);
    expect(await main(['clean', '--approved', '--root', root], print)).toBe(0);
    expect(await existe(a)).toBe(false);
    expect(await existe(b)).toBe(false);

    for (const op of cuarentenas) {
      expect(await main(['restore', op.id], print)).toBe(0);
    }
    expect(await sha(a)).toBe(antes.a);
    expect(await sha(b)).toBe(antes.b);
    if (posix) expect((await stat(b)).mode & 0o777).toBe(0o640);
    expect(salida.join('\n')).not.toContain('Permisos: unsupported');

    // La aprobacion se consumio: un segundo clean no tiene nada que hacer.
    expect(await main(['clean', '--approved', '--root', root], print)).toBe(2);
  });

  it('clean aborta entero si un fichero aprobado cambio despues', async () => {
    const a = await logViejo('debug.log', 'uno');
    const b = await logViejo('otro.log', 'dos');
    expect(await main(['approve', '--risk', 'safe', '--root', root], print)).toBe(0);
    await writeFile(b, 'dos, pero cambiado');

    expect(await main(['clean', '--approved', '--root', root], print)).toBe(2);
    expect(salida.join('\n')).toContain('Nothing was modified');
    expect(await existe(a)).toBe(true);
    expect(await existe(b)).toBe(true);
  });

  it('restore aborta si el payload fue manipulado y no toca el workspace', async () => {
    const a = await logViejo('debug.log', 'uno');
    expect(await main(['approve', '--risk', 'safe', '--root', root], print)).toBe(0);
    expect(await main(['clean', '--approved', '--root', root], print)).toBe(0);

    const [entrada] = await findEntries(home, 'OP-000001');
    await writeFile(entrada!.manifest.quarantine_path, 'manipulado');

    expect(await main(['restore', 'OP-000001'], print)).toBe(2);
    expect(salida.join('\n')).toContain('hash');
    expect(await existe(a)).toBe(false);
  });
});
