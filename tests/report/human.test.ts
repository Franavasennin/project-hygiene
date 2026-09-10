import { describe, it, expect } from 'vitest';
import { renderReport } from '../../src/report/human.js';
import type { AuditResult } from '../../src/core/types.js';

const base: AuditResult = {
  inventory: { root: '/x', scannedAt: '', truncated: false, files: [], projects: [], gitByProject: {} },
  findings: [{
    id: 'F-000001', ruleId: 'FS-TEMP-001', axis: 'filesystem', path: 'debug.log',
    severity: 'low', risk: 'safe', confidence: 0.9, reason: 'Log abandonado',
    evidence: {}, suggests: ['review'],
  }],
  limits: [],
  score: {
    profile: 'v1-core', engineVersion: '0.1.0', total: 97,
    axes: { filesystem: 27, git: 25, security: 30, ai: 15 },
    clean: false, blockers: [],
  },
};

describe('renderReport', () => {
  it('muestra la puntuacion y la regla', () => {
    const out = renderReport(base);
    expect(out).toContain('97/100');
    expect(out).toContain('FS-TEMP-001');
    expect(out).toContain('debug.log');
  });

  it('lista los bloqueadores cuando existen', () => {
    const out = renderReport({
      ...base,
      score: { ...base.score, blockers: ['1 hallazgo critical'] },
    });
    expect(out).toContain('critical');
  });

  it('nunca imprime el contenido de evidence, solo metadatos conocidos', () => {
    const conEvidenciaSensible = {
      ...base,
      findings: [{
        ...base.findings[0]!,
        evidence: { size: 10, mtimeMs: 0, depth: 1, secretoFiltrado: 'CONTENIDO-DE-FICHERO-SENSIBLE' },
      }],
    };
    const out = renderReport(conEvidenciaSensible);
    expect(out).not.toContain('CONTENIDO-DE-FICHERO-SENSIBLE');
  });

  it('un axis desconocido en score.axes se muestra igualmente, no se pierde', () => {
    const conAxisDesconocido = {
      ...base,
      score: { ...base.score, axes: { ...base.score.axes, dependencies: 12 } as never },
    };
    const out = renderReport(conAxisDesconocido);
    expect(out).toContain('dependencies');
    expect(out).toContain('12');
  });

  it('un arbol sin hallazgos muestra "Sin hallazgos"', () => {
    const sinHallazgos = { ...base, findings: [] };
    const out = renderReport(sinHallazgos);
    expect(out).toContain('Sin hallazgos.');
  });

  it('mas de 3 paths para la misma regla activa el resumen "y N mas"', () => {
    const muchos = {
      ...base,
      findings: Array.from({ length: 5 }, (_, i) => ({
        ...base.findings[0]!,
        id: `F-${i}`,
        path: `debug${i}.log`,
      })),
    };
    const out = renderReport(muchos);
    expect(out).toContain('y 2 mas');
  });

  it('score.clean true muestra el estado LIMPIO', () => {
    const limpio = { ...base, findings: [], score: { ...base.score, clean: true, blockers: [] } };
    const out = renderReport(limpio);
    expect(out).toContain('Estado: LIMPIO');
  });
});
