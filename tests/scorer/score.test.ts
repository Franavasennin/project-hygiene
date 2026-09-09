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

  // Calculo manual para el hallazgo low por defecto (axis filesystem):
  // penalty.filesystem = SEVERITY_WEIGHT.low * sqrt(1) = 1 * 1 = 1
  // value = WEIGHT.filesystem * (1 - penalty/SATURATION.filesystem)
  //       = 30 * (1 - 1/60) = 30 * (59/60) = 29.5
  // axes.filesystem = round(29.5 * 100) / 100 = 29.5
  // resto de ejes sin penalizacion: git 25, security 30, ai 15
  // total = 29.5 + 25 + 30 + 15 = 99.5
  it('un unico hallazgo low no desaparece al redondear (regresion)', () => {
    const s = computeScore([f({ severity: 'low' })], []);
    expect(s.total).toBe(99.5);
    expect(s.axes.filesystem).toBe(29.5);
  });

  it('total es exactamente la suma de los axes mostrados', () => {
    const s = computeScore([f({ severity: 'medium', axis: 'git', ruleId: 'GIT-DIRTY-001' })], []);
    const sumaEjes = Object.values(s.axes).reduce((a, b) => a + b, 0);
    expect(s.total).toBeCloseTo(sumaEjes, 10);
  });
});
