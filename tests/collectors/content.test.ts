import { describe, it, expect } from 'vitest';
import { shannonEntropy, looksBinary } from '../../src/collectors/content.js';

describe('content', () => {
  it('da entropia baja a texto repetido', () => {
    expect(shannonEntropy('aaaaaaaaaaaaaaaa')).toBeLessThan(1);
  });

  it('da entropia alta a una cadena aleatoria', () => {
    expect(shannonEntropy('kJ8fQ2xZ7pR4vN1mB6tL9wY3')).toBeGreaterThan(4);
  });

  it('detecta binario por byte nulo', () => {
    expect(looksBinary(Buffer.from([0x41, 0x00, 0x42]))).toBe(true);
    expect(looksBinary(Buffer.from('hola', 'utf8'))).toBe(false);
  });
});
