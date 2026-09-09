import { describe, it, expect } from 'vitest';
import { computeScore } from '../../src/scorer/score.js';
import type { Finding } from '../../src/core/types.js';

const f = (over: Partial<Finding>): Finding => ({
  id: 'F-1', ruleId: 'FS-TEMP-001', axis: 'filesystem', path: 'a.log',
  severity: 'low', risk: 'safe', confidence: 0.9, reason: '', evidence: {},
  suggests: ['review'], ...over,
});

describe('computeScore', () => {
  it('sin hallazgos da 100 y limpio', () => {
    const s = computeScore([], []);
    expect(s.total).toBe(100);
    expect(s.clean).toBe(true);
  });

  it('cien hallazgos pesan diez veces mas que uno, no cien', () => {
    const uno = computeScore([f({})], []);
    const cien = computeScore(Array.from({ length: 100 }, () => f({})), []);
    const bajaUno = 100 - uno.total;
    const bajaCien = 100 - cien.total;
    expect(bajaCien).toBeGreaterThan(bajaUno * 8);
    expect(bajaCien).toBeLessThan(bajaUno * 12);
  });

  it('un hallazgo critico topa el total en 59', () => {
    const s = computeScore(
      [f({ axis: 'security', severity: 'critical', ruleId: 'SEC-SECRET-001' })], []);
    expect(s.total).toBeLessThanOrEqual(59);
    expect(s.clean).toBe(false);
    expect(s.blockers.join(' ')).toContain('critical');
  });

  it('un riesgo unknown impide declarar limpio sin restar', () => {
    const s = computeScore([f({ severity: 'info', risk: 'unknown' })], []);
    expect(s.total).toBe(100);
    expect(s.clean).toBe(false);
  });

  it('un limite de ejecucion impide declarar limpio', () => {
    const s = computeScore([], [{ ruleId: 'FS-TEMP-001', limit: 'timeout_ms_per_rule' }]);
    expect(s.clean).toBe(false);
    expect(s.blockers.join(' ')).toContain('FS-TEMP-001');
  });
});
