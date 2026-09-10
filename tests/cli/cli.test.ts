import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../../src/cli/index.js';

let root: string;
let salida: string[];
const print = (s: string) => { salida.push(s); };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'hyg-cli-'));
  salida = [];
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

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
});
