import { describe, it, expect } from 'vitest';
import { appendLine } from '../../src/executor/ignore.js';

describe('appendLine', () => {
  it('crea el contenido si no habia fichero', () => {
    expect(appendLine(null, '/dist/')).toBe('/dist/\n');
  });
  it('anade la linea respetando el salto final', () => {
    expect(appendLine('a\n', '/dist/')).toBe('a\n/dist/\n');
    expect(appendLine('a', '/dist/')).toBe('a\n/dist/\n');
  });
  it('no duplica una linea existente', () => {
    expect(appendLine('/dist/\r\nb\n', '/dist/')).toBe('/dist/\r\nb\n');
  });
});
