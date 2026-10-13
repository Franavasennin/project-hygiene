import { describe, it, expect } from 'vitest';
import { replaceBlock } from '../../src/init/blocks.js';

const S = '# >>> hygiene';
const E = '# <<< hygiene';

describe('replaceBlock', () => {
  it('crea el bloque si no habia fichero', () => {
    expect(replaceBlock(null, S, E, 'a\nb')).toBe(`${S}\na\nb\n${E}\n`);
  });
  it('anade el bloque al final conservando lo existente', () => {
    expect(replaceBlock('mio\n', S, E, 'a')).toBe(`mio\n\n${S}\na\n${E}\n`);
  });
  it('sustituye un bloque existente', () => {
    const before = `mio\n\n${S}\nviejo\n${E}\nfinal\n`;
    expect(replaceBlock(before, S, E, 'nuevo')).toBe(`mio\n\n${S}\nnuevo\n${E}\nfinal\n`);
  });
  it('es idempotente', () => {
    const once = replaceBlock('mio\n', S, E, 'a');
    expect(replaceBlock(once, S, E, 'a')).toBe(once);
  });
});
