import type { AuditResult, Axis } from '../core/types.js';

const AXIS_LABEL: Record<Axis, string> = {
  filesystem: 'Ficheros', git: 'Git', security: 'Seguridad', ai: 'IA',
};

export function renderReport(result: AuditResult): string {
  const { score, findings, limits } = result;
  const out: string[] = [];

  out.push(`Puntuacion: ${score.total}/100  perfil ${score.profile}  motor ${score.engineVersion}`);
  out.push('');
  for (const axis of Object.keys(AXIS_LABEL) as Axis[]) {
    out.push(`  ${AXIS_LABEL[axis].padEnd(10)} ${String(score.axes[axis]).padStart(6)}`);
  }
  out.push('');

  if (findings.length === 0) {
    out.push('Sin hallazgos.');
  } else {
    const porRegla = new Map<string, number>();
    for (const f of findings) porRegla.set(f.ruleId, (porRegla.get(f.ruleId) ?? 0) + 1);

    out.push(`Hallazgos: ${findings.length}`);
    for (const [ruleId, n] of [...porRegla].sort((a, b) => b[1] - a[1])) {
      const ejemplo = findings.find((f) => f.ruleId === ruleId);
      out.push(`  ${ruleId.padEnd(16)} ${String(n).padStart(4)}  ${ejemplo?.reason ?? ''}`);
      for (const f of findings.filter((x) => x.ruleId === ruleId).slice(0, 3)) {
        out.push(`      ${f.path}`);
      }
      if (n > 3) out.push(`      y ${n - 3} mas`);
    }
  }

  if (limits.length > 0) {
    out.push('');
    out.push('Limites de ejecucion alcanzados:');
    for (const l of limits) out.push(`  RULE_EXECUTION_LIMIT ${l.ruleId} (${l.limit})`);
  }

  out.push('');
  if (score.clean) {
    out.push('Estado: LIMPIO');
  } else {
    out.push('Estado: NO LIMPIO');
    for (const b of score.blockers) out.push(`  - ${b}`);
  }

  return out.join('\n');
}
