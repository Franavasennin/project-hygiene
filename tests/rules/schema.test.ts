import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parsePack, loadPacks, PackValidationError } from '../../src/rules/schema.js';

const valido = `
schema_version: 1
pack_id: test.pack
version: 1.0.0
axis: filesystem
rules:
  - id: FS-TEMP-001
    title: Log abandonado
    why: Los logs son artefactos generados.
    severity: low
    risk: safe
    confidence: 0.9
    match:
      all:
        - glob: "**/*.log"
        - is_file: true
    suggests:
      - type: review
`;

describe('parsePack', () => {
  it('acepta un pack valido', () => {
    const pack = parsePack(valido, 'test.yml');
    expect(pack.rules[0]?.id).toBe('FS-TEMP-001');
  });

  it('rechaza un predicado desconocido', () => {
    const malo = valido.replace('- glob: "**/*.log"', '- ejecuta_shell: "rm -rf /"');
    expect(() => parsePack(malo, 'test.yml')).toThrow(PackValidationError);
  });

  it('rechaza un campo de mas en la regla', () => {
    const malo = valido.replace('    confidence: 0.9', '    confidence: 0.9\n    inventado: si');
    expect(() => parsePack(malo, 'test.yml')).toThrow(PackValidationError);
  });

  it('rechaza un id que no sigue el patron', () => {
    const malo = valido.replace('FS-TEMP-001', 'temporales');
    expect(() => parsePack(malo, 'test.yml')).toThrow(PackValidationError);
  });

  it('rechaza una regex peligrosa dentro del match', () => {
    const malo = valido.replace('- glob: "**/*.log"', '- basename_regex: "(a+)+$"');
    expect(() => parsePack(malo, 'test.yml')).toThrow(PackValidationError);
  });

  it('rechaza YAML sintacticamente invalido con PackValidationError', () => {
    const invalido = 'schema_version: 1\npack_id: [esto no cierra';
    expect(() => parsePack(invalido, 'roto.yml')).toThrow(PackValidationError);
  });

  it('rechaza un combinador any vacio', () => {
    const malo = valido.replace(
      'match:\n      all:\n        - glob: "**/*.log"\n        - is_file: true',
      'match:\n      any: []',
    );
    expect(() => parsePack(malo, 'test.yml')).toThrow(PackValidationError);
  });

  it('loadPacks rechaza IDs de regla duplicados entre dos ficheros distintos', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'hyg-packs-'));
    try {
      await copyFile(
        path.join(process.cwd(), 'rules', 'pack.schema.json'),
        path.join(dir, 'pack.schema.json'),
      );
      const reglaBase = `
schema_version: 1
pack_id: pack.uno
version: 1.0.0
axis: filesystem
rules:
  - id: FS-DUP-999
    title: Regla de prueba
    why: Solo para el test.
    severity: low
    risk: safe
    confidence: 0.5
    match:
      is_file: true
    suggests:
      - type: review
`;
      await writeFile(path.join(dir, 'a.yml'), reglaBase);
      await writeFile(path.join(dir, 'b.yml'), reglaBase.replace('pack.uno', 'pack.dos'));

      await expect(loadPacks(dir)).rejects.toThrow(PackValidationError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
