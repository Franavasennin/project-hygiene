import { describe, it, expect } from 'vitest';
import { Budget, DEFAULT_LIMITS } from '../../src/core/limits.js';

describe('Budget', () => {
  it('agota el contador de ficheros y lo reporta', () => {
    const b = new Budget({ ...DEFAULT_LIMITS, maxFilesScanned: 2 });
    expect(b.consumeFile()).toBe(true);
    expect(b.consumeFile()).toBe(true);
    expect(b.consumeFile()).toBe(false);
    expect(b.hits()).toContain('maxFilesScanned');
  });

  it('detecta la fecha limite por regla', () => {
    const b = new Budget({ ...DEFAULT_LIMITS, timeoutMsPerRule: 0 });
    b.startRule('FS-TEMP-001');
    expect(b.ruleExpired()).toBe(true);
  });
});
