import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, utimes, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../../src/cli/index.js';

let root: string;
let home: string;
let salida: string[];
const print = (s: string) => { salida.push(s); };
const homePrevio = process.env.HYGIENE_HOME;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'hyg-cli-'));
  home = await mkdtemp(path.join(tmpdir(), 'hyg-cli-home-'));
  process.env.HYGIENE_HOME = home;
  salida = [];
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
  if (homePrevio === undefined) delete process.env.HYGIENE_HOME;
  else process.env.HYGIENE_HOME = homePrevio;
});

async function logViejo(nombre: string, contenido = 'x'): Promise<void> {
  const p = path.join(root, nombre);
  await writeFile(p, contenido);
  const viejo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  await utimes(p, viejo, viejo);
}

describe('main', () => {
  it('audit sobre un arbol limpio devuelve 0', async () => {
    const code = await main(['audit', root], print);
    expect(code).toBe(0);
    expect(salida.join('\n')).toContain('LIMPIO');
  });

  it('audit --json emite JSON parseable', async () => {
    const code = await main(['audit', root, '--json'], print);
    expect(code).toBe(0);
    expect(() => JSON.parse(salida.join('\n'))).not.toThrow();
  });

  it('plan sobre un arbol limpio devuelve 0 y no propone nada', async () => {
    const code = await main(['plan', root], print);
    expect(code).toBe(0);
    expect(salida.join('\n')).toContain('Sin operaciones propuestas.');
  });

  it('plan --json emite el plan con sus operaciones', async () => {
    await writeFile(path.join(root, 'id_rsa'), '-----BEGIN RSA PRIVATE KEY-----');
    const code = await main(['plan', root, '--json'], print);
    expect(code).toBe(1);
    const plan = JSON.parse(salida.join('\n')) as { operations: { path: string }[] };
    expect(plan.operations.some((o) => o.path === 'id_rsa')).toBe(true);
  });

  it('explain devuelve el porque de una regla', async () => {
    const code = await main(['explain', 'FS-TEMP-001'], print);
    expect(code).toBe(0);
    expect(salida.join('\n')).toContain('artefacto generado');
  });

  it('explain de una regla inexistente devuelve 2', async () => {
    expect(await main(['explain', 'NO-EXISTE-001'], print)).toBe(2);
  });

  it('un comando desconocido devuelve 2', async () => {
    expect(await main(['inventado'], print)).toBe(2);
  });

  it('un arbol con clave privada devuelve 1', async () => {
    await writeFile(path.join(root, 'id_rsa'), '-----BEGIN RSA PRIVATE KEY-----');
    expect(await main(['audit', root], print)).toBe(1);
  });

  it('--help sin comando devuelve 0 y muestra el uso', async () => {
    const code = await main(['--help'], print);
    expect(code).toBe(0);
    expect(salida.join('\n')).toContain('Comandos:');
  });

  it('un comando invalido con --help muestra el uso y devuelve 0 (--help tiene prioridad)', async () => {
    const code = await main(['inventado', '--help'], print);
    expect(code).toBe(0);
  });

  it('audit sobre una ruta que no existe devuelve 2', async () => {
    const code = await main(['audit', path.join(root, 'no-existe')], print);
    expect(code).toBe(2);
  });

  it('audit sobre una ruta que es un fichero devuelve 2', async () => {
    const ficheroComoRoot = path.join(root, 'no-es-directorio.txt');
    await writeFile(ficheroComoRoot, 'x');
    const code = await main(['audit', ficheroComoRoot], print);
    expect(code).toBe(2);
  });

  it('approve sin IDs ni --risk devuelve 2', async () => {
    expect(await main(['approve', '--root', root], print)).toBe(2);
  });

  it('approve con --risk invalido devuelve 2', async () => {
    expect(await main(['approve', '--risk', 'unknown', '--root', root], print)).toBe(2);
  });

  it('approve --risk safe registra la aprobacion en HYGIENE_HOME', async () => {
    await logViejo('debug.log');
    const code = await main(['approve', '--risk', 'safe', '--root', root], print);
    expect(code).toBe(0);
    expect(salida.join('\n')).toContain('Aprobadas: OP-000001');
    expect(await readdir(path.join(home, 'approvals'))).toHaveLength(1);
  });

  it('approve de un ID inexistente devuelve 2 y no registra nada', async () => {
    expect(await main(['approve', 'OP-000099', '--root', root], print)).toBe(2);
    await expect(readdir(path.join(home, 'approvals'))).rejects.toThrow();
  });

  it('approve --reset descarta las aprobaciones pendientes', async () => {
    await logViejo('debug.log');
    await main(['approve', '--risk', 'safe', '--root', root], print);
    expect(await main(['approve', '--reset', '--root', root], print)).toBe(0);
    expect(await readdir(path.join(home, 'approvals'))).toHaveLength(0);
  });

  it('clean sin --approved se niega y no modifica nada', async () => {
    await logViejo('debug.log');
    expect(await main(['clean', '--root', root], print)).toBe(2);
    expect(salida.join('\n')).toContain('ERROR: No approved operations. Nothing was modified.');
    expect(await readdir(root)).toEqual(['debug.log']);
  });

  it('clean --approved sin aprobaciones devuelve 2', async () => {
    expect(await main(['clean', '--approved', '--root', root], print)).toBe(2);
    expect(salida.join('\n')).toContain('No approved operations');
  });

  it('restore sin referencia devuelve 2', async () => {
    expect(await main(['restore'], print)).toBe(2);
  });

  it('restore de una operacion inexistente devuelve 2', async () => {
    expect(await main(['restore', 'OP-000999'], print)).toBe(2);
    expect(salida.join('\n')).toContain('No hay ninguna entrada de cuarentena');
  });

  it('restore rechaza referencias mal formadas', async () => {
    expect(await main(['restore', '../../etc'], print)).toBe(2);
  });
});
