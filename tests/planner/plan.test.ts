import { describe, it, expect } from 'vitest';
import type { FileEntry, Finding, Inventory } from '../../src/core/types.js';
import {
  planOperations, DEFAULT_POLICY, EXECUTABLE_TYPES, type PlannerInput,
} from '../../src/planner/plan.js';

function entrada(p: string, extra: Partial<FileEntry> = {}): FileEntry {
  return {
    path: p, absPath: `/r/${p}`, isDir: false, isSymlink: false, size: 10,
    mtimeMs: 0, depth: p.split('/').length, notDescended: false, ...extra,
  };
}

function hallazgo(p: string, extra: Partial<Finding> = {}): Finding {
  return {
    id: 'F-000001', ruleId: 'FS-TEMP-001', axis: 'filesystem', path: p,
    severity: 'low', risk: 'safe', confidence: 0.9,
    reason: 'Fichero de log abandonado', evidence: {},
    suggests: ['quarantine', 'review'], ...extra,
  };
}

function entradaPlanner(findings: Finding[], extra: Partial<PlannerInput> = {}): PlannerInput {
  const rutas = [...new Set(findings.map((f) => f.path))];
  const inventory: Inventory = {
    root: '/r', scannedAt: '', truncated: false,
    files: rutas.map((p) => entrada(p)), projects: [], gitByProject: {},
  };
  return {
    findings,
    inventory,
    referenced: new Set(),
    referencesComplete: true,
    hashes: new Map(rutas.map((p) => [p, `h-${p}`])),
    policy: DEFAULT_POLICY,
    ...extra,
  };
}

describe('planOperations', () => {
  it('propone cuarentena cuando no hay motivo para degradar', () => {
    const [op] = planOperations(entradaPlanner([hallazgo('debug.log')]));
    expect(op).toMatchObject({
      id: 'OP-000001', type: 'quarantine', path: 'debug.log', risk: 'safe',
      degradedFrom: null, degradeReason: null,
      source: { sha256: 'h-debug.log', size: 10 },
    });
  });

  it('riesgo unknown produce review y nada mas', () => {
    const [op] = planOperations(entradaPlanner([hallazgo('a.log', { risk: 'unknown' })]));
    expect(op).toMatchObject({ type: 'review', degradedFrom: 'quarantine', degradeReason: 'unknown-risk' });
  });

  it('confianza por debajo del umbral degrada a review', () => {
    const [op] = planOperations(entradaPlanner([hallazgo('a.log', { confidence: 0.5 })]));
    expect(op).toMatchObject({ type: 'review', degradeReason: 'low-confidence' });
  });

  it('el umbral es configurable', () => {
    const input = entradaPlanner([hallazgo('a.log', { confidence: 0.5 })], { policy: { minConfidence: 0.4 } });
    expect(planOperations(input)[0]?.type).toBe('quarantine');
  });

  it('nunca pone en cuarentena algo referenciado', () => {
    const input = entradaPlanner([hallazgo('a.log')], { referenced: new Set(['a.log']) });
    expect(planOperations(input)[0]).toMatchObject({ type: 'review', degradeReason: 'referenced-by-source' });
  });

  it('nunca pone en cuarentena si las referencias no se pudieron determinar', () => {
    const input = entradaPlanner([hallazgo('a.log')], { referencesComplete: false });
    expect(planOperations(input)[0]).toMatchObject({ type: 'review', degradeReason: 'references-undetermined' });
  });

  it('dentro de una frontera desconocida solo propone review', () => {
    const input = entradaPlanner([hallazgo('x/a.log'), hallazgo('xy/b.log', { id: 'F-000002' })]);
    input.inventory.projects = [
      { path: 'x', confidence: 0.5, markers: ['package.json'], status: 'unknown-boundary' },
    ];
    const ops = planOperations(input);
    expect(ops.find((o) => o.path === 'x/a.log'))
      .toMatchObject({ type: 'review', degradeReason: 'unknown-project-boundary' });
    expect(ops.find((o) => o.path === 'xy/b.log')?.type).toBe('quarantine');
  });

  it('si la raiz misma es frontera desconocida, nada va a cuarentena', () => {
    const input = entradaPlanner([hallazgo('a.log')]);
    input.inventory.projects = [
      { path: '.', confidence: 0.5, markers: ['package.json'], status: 'unknown-boundary' },
    ];
    expect(planOperations(input)[0]?.type).toBe('review');
  });

  it('un directorio no va a cuarentena', () => {
    const input = entradaPlanner([hallazgo('logs')]);
    input.inventory.files = [entrada('logs', { isDir: true })];
    expect(planOperations(input)[0]).toMatchObject({ type: 'review', degradeReason: 'not-a-regular-file' });
  });

  it('sin huella no hay cuarentena', () => {
    const input = entradaPlanner([hallazgo('a.log')], { hashes: new Map([['a.log', null]]) });
    expect(planOperations(input)[0]).toMatchObject({ type: 'review', degradeReason: 'hash-unavailable' });
  });

  it('una sugerencia review no se marca como degradada', () => {
    const [op] = planOperations(entradaPlanner([
      hallazgo('notas-final.md', { ruleId: 'FS-NAMING-001', suggests: ['review'], confidence: 0.7 }),
    ]));
    expect(op).toMatchObject({ type: 'review', degradedFrom: null, degradeReason: null });
  });

  it('none no produce operacion', () => {
    expect(planOperations(entradaPlanner([hallazgo('a.log', { suggests: ['none'] })]))).toEqual([]);
  });

  it('una ruta con sugerencias en conflicto produce una sola operacion review', () => {
    const ops = planOperations(entradaPlanner([
      hallazgo('debug-final.log', { id: 'F-000001' }),
      hallazgo('debug-final.log', {
        id: 'F-000002', ruleId: 'FS-NAMING-001', suggests: ['review'], risk: 'medium', confidence: 0.9,
      }),
    ]));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      type: 'review',
      degradedFrom: 'quarantine',
      degradeReason: 'conflicting-suggestions',
      risk: 'medium',
      ruleIds: ['FS-NAMING-001', 'FS-TEMP-001'],
      findingIds: ['F-000002', 'F-000001'],
    });
  });

  it('los IDs siguen el orden de ruta y no dependen del orden de entrada', () => {
    const fs = [
      hallazgo('b.log', { id: 'F-000001' }),
      hallazgo('a.log', { id: 'F-000002' }),
      hallazgo('c.log', { id: 'F-000003' }),
    ];
    const uno = planOperations(entradaPlanner(fs));
    const dos = planOperations(entradaPlanner([...fs].reverse()));
    expect(uno.map((o) => [o.id, o.path])).toEqual([
      ['OP-000001', 'a.log'], ['OP-000002', 'b.log'], ['OP-000003', 'c.log'],
    ]);
    expect(dos).toEqual(uno);
  });

  it('solo quarantine es ejecutable en esta version', () => {
    expect([...EXECUTABLE_TYPES]).toEqual(['quarantine']);
  });
});
