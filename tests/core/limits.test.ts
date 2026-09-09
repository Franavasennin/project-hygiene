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

  it('totalExpired usa el reloj inyectado', () => {
    let clock = 1000;
    const b = new Budget({ ...DEFAULT_LIMITS, timeoutMsTotal: 500 }, () => clock);
    expect(b.totalExpired()).toBe(false);
    clock = 1600;
    expect(b.totalExpired()).toBe(true);
    expect(b.hits()).toContain('timeoutMsTotal');
  });

  it('ruleExpired es false antes del deadline y respeta el reloj inyectado', () => {
    let clock = 1000;
    const b = new Budget({ ...DEFAULT_LIMITS, timeoutMsPerRule: 500 }, () => clock);
    b.startRule('FS-TEMP-001');
    expect(b.ruleExpired()).toBe(false);
    clock = 1600;
    expect(b.ruleExpired()).toBe(true);
  });

  it('within comprueba y anota en una sola llamada', () => {
    const b = new Budget({ ...DEFAULT_LIMITS, maxRuleMatches: 3 });
    expect(b.within('maxRuleMatches', 2)).toBe(true);
    expect(b.within('maxRuleMatches', 3)).toBe(false);
    expect(b.hits()).toContain('maxRuleMatches');
  });

  it('hits() no repite un limite anotado varias veces', () => {
    const b = new Budget({ ...DEFAULT_LIMITS, maxFilesScanned: 0 });
    b.consumeFile();
    b.consumeFile();
    expect(b.hits().filter((h) => h === 'maxFilesScanned')).toHaveLength(1);
  });
});
