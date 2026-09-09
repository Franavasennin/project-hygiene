import { describe, it, expect } from 'vitest';
import { parsePack, PackValidationError } from '../../src/rules/schema.js';

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
});
