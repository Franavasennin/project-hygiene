// tests/rules/regex-guard.test.ts
import { describe, it, expect } from 'vitest';
import { assertSafeRegex, UnsafeRegexError } from '../../src/rules/regex-guard.js';

describe('assertSafeRegex', () => {
  it('acepta un patron corriente', () => {
    expect(() => assertSafeRegex('(?i)\\.log$')).not.toThrow();
  });

  it('rechaza cuantificador anidado', () => {
    expect(() => assertSafeRegex('(a+)+$')).toThrow(UnsafeRegexError);
  });

  it('rechaza alternancia repetida ambigua', () => {
    expect(() => assertSafeRegex('(a|aa)*$')).toThrow(UnsafeRegexError);
  });

  it('rechaza un patron excesivamente largo', () => {
    expect(() => assertSafeRegex('a'.repeat(1001))).toThrow(UnsafeRegexError);
  });
});
