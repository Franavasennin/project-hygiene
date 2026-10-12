import { describe, it, expect } from 'vitest';
import type { Operation, Plan } from '../../src/core/types.js';
import { renderPlan } from '../../src/report/plan.js';

function op(extra: Partial<Operation>): Operation {
  return {
    id: 'OP-000001', type: 'quarantine', path: 'debug.log', findingIds: ['F-000001'],
    ruleIds: ['FS-TEMP-001'], risk: 'safe', reason: 'Fichero de log abandonado',
    degradedFrom: null, degradeReason: null, source: { sha256: 'abc', size: 1 }, ...extra,
  };
}

function plan(operations: Operation[]): Plan {
  return {
    planId: '0123456789abcdef', root: '/ws', createdAt: '2026-09-26T00:00:00.000Z',
    engineVersion: '0.1.0', minConfidence: 0.8, operations,
  };
}

describe('renderPlan', () => {
  it('lista cada operacion con su ID, tipo y ruta', () => {
    const s = renderPlan(plan([op({})]));
    expect(s).toContain('OP-000001');
    expect(s).toContain('quarantine');
    expect(s).toContain('debug.log');
    expect(s).toContain('Aprobables: OP-000001');
  });

  it('explica por que se degrado una operacion', () => {
    const s = renderPlan(plan([op({ type: 'review', degradedFrom: 'quarantine', degradeReason: 'referenced-by-source' })]));
    expect(s).toContain('degradada desde quarantine: referenced-by-source');
    expect(s).not.toContain('Aprobables');
  });

  it('un plan vacio lo dice y recuerda que no ha modificado nada', () => {
    const s = renderPlan(plan([]));
    expect(s).toContain('Sin operaciones propuestas.');
    expect(s).toContain('Este comando no ha modificado nada.');
  });
});
