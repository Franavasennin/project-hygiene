import { describe, it, expect } from 'vitest';
import { parsePack, PackValidationError } from '../../src/rules/schema.js';

const pack = (rule: string) => [
  'schema_version: 1', 'pack_id: test.scope', 'version: 1.0.0', 'axis: git', 'rules:',
  '  - id: GIT-TEST-001', '    title: t', '    why: w', '    severity: low', '    risk: low',
  '    confidence: 0.5', '    suggests: [{ type: review }]', rule,
].join('\n');

describe('scope de regla', () => {
  it('acepta una regla de proyecto con predicados de proyecto', () => {
    expect(() => parsePack(pack("    scope: project\n    match: { has_child: ['.git'] }"), 't.yml')).not.toThrow();
  });

  it('rechaza un predicado de proyecto en una regla de fichero', () => {
    expect(() => parsePack(pack("    match: { has_child: ['.git'] }"), 't.yml')).toThrow(PackValidationError);
  });

  it('rechaza un scope desconocido', () => {
    expect(() => parsePack(pack('    scope: repo\n    match: { is_file: true }'), 't.yml')).toThrow(PackValidationError);
  });

  it('valida la forma de in_git_history', () => {
    expect(() => parsePack(pack("    scope: project\n    match: { in_git_history: { paths: ['**/.env'] } }"), 't.yml')).not.toThrow();
    expect(() => parsePack(pack("    scope: project\n    match: { in_git_history: ['**/.env'] }"), 't.yml')).toThrow(PackValidationError);
  });
});
