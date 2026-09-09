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
});
