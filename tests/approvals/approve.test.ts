import { describe, it, expect } from 'vitest';
import type { Operation, Plan } from '../../src/core/types.js';
import { selectOperations, mergeApproval } from '../../src/approvals/approve.js';

function op(id: string, extra: Partial<Operation> = {}): Operation {
  return {
    id, type: 'quarantine', path: `${id}.log`, findingIds: [], ruleIds: ['FS-TEMP-001'],
    risk: 'safe', reason: 'r', degradedFrom: null, degradeReason: null,
    source: { sha256: `h-${id}`, size: 1 }, ...extra,
  };
}

const PLAN: Plan = {
  planId: 'p', root: '/ws', createdAt: '', engineVersion: '0.1.0', minConfidence: 0.8,
  operations: [
    op('OP-000001'),
    op('OP-000002', { risk: 'low' }),
    op('OP-000003', { risk: 'medium' }),
    op('OP-000004', { type: 'review', source: { sha256: null, size: 1 } }),
  ],
};

const ids = (ops: Operation[]) => ops.map((o) => o.id);

describe('selectOperations', () => {
  it('selecciona por ID', () => {
    expect(ids(selectOperations({ plan: PLAN, ids: ['OP-000002'] }).selected)).toEqual(['OP-000002']);
  });

  it('un ID inexistente anula toda la seleccion', () => {
    const r = selectOperations({ plan: PLAN, ids: ['OP-000001', 'OP-000099'] });
    expect(r.selected).toEqual([]);
    expect(r.errors[0]).toContain('OP-000099');
  });

  it('una operacion review no se aprueba', () => {
    const r = selectOperations({ plan: PLAN, ids: ['OP-000004'] });
    expect(r.selected).toEqual([]);
    expect(r.errors[0]).toContain('review');
  });

  it('--risk safe se expande solo a operaciones safe', () => {
    expect(ids(selectOperations({ plan: PLAN, ids: [], risk: 'safe' }).selected)).toEqual(['OP-000001']);
  });

  it('--risk medium incluye safe, low y medium', () => {
    expect(ids(selectOperations({ plan: PLAN, ids: [], risk: 'medium' }).selected))
      .toEqual(['OP-000001', 'OP-000002', 'OP-000003']);
  });

  it('IDs y --risk se suman sin duplicar', () => {
    expect(ids(selectOperations({ plan: PLAN, ids: ['OP-000001', 'OP-000003'], risk: 'safe' }).selected))
      .toEqual(['OP-000001', 'OP-000003']);
  });
});

describe('mergeApproval', () => {
  const ahora = new Date('2026-09-26T10:00:00.000Z');

  it('materializa la expansion de --risk como lista explicita de IDs', () => {
    const rec = mergeApproval(null, PLAN, [PLAN.operations[0]!], ['--risk', 'safe'], ahora);
    expect(rec.requests).toEqual([{ at: ahora.toISOString(), args: ['--risk', 'safe'], expanded: ['OP-000001'] }]);
    expect(rec.operations).toEqual([{
      id: 'OP-000001', type: 'quarantine', path: 'OP-000001.log', sha256: 'h-OP-000001',
      size: 1, risk: 'safe', ruleIds: ['FS-TEMP-001'],
    }]);
    expect(rec.root).toBe('/ws');
  });

  it('acumula aprobaciones sin duplicar la misma operacion', () => {
    const [a, b] = PLAN.operations;
    const uno = mergeApproval(null, PLAN, [a!], ['OP-000001'], ahora);
    const dos = mergeApproval(uno, PLAN, [a!, b!], ['OP-000001', 'OP-000002'], ahora);
    expect(dos.operations.map((o) => o.id)).toEqual(['OP-000001', 'OP-000002']);
    expect(dos.requests).toHaveLength(2);
  });

  it('una operacion ejecutable sin huella rompe un invariante', () => {
    expect(() => mergeApproval(null, PLAN, [op('OP-000009', { source: { sha256: null, size: 0 } })], [], ahora))
      .toThrow(/sin huella/);
  });
});
