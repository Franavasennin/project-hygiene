import type { AuditResult, Axis } from '../core/types.js';

const AXIS_LABEL: Record<Axis, string> = {
  filesystem: 'Ficheros', git: 'Git', security: 'Seguridad', ai: 'IA',
};

export function renderReport(result: AuditResult): string {
  const { score, findings, limits } = result;
  const out: string[] = [];

  out.push(`Puntuacion: ${score.total}/100  perfil ${score.profile}  motor ${score.engineVersion}`);
  out.push('');
  for (const axis of Object.keys(score.axes) as Axis[]) {
    const etiqueta = AXIS_LABEL[axis] ?? axis;
    out.push(`  ${etiqueta.padEnd(10)} ${String(score.axes[axis]).padStart(6)}`);
  }
  out.push('');

  // Nunca se imprime finding.evidence directamente: solo metadatos ya
  // conocidos (ruleId, path, reason -- este ultimo es texto fijo de la
  // regla YAML, no contenido dinamico). Si evidence alguna vez necesitara
  // mostrarse, debe pasar antes por una lista explicita de claves seguras,
  // nunca volcarse tal cual.
  if (findings.length === 0) {
    out.push('Sin hallazgos.');
  } else {
    const porRegla = new Map<string, typeof findings>();
    for (const f of findings) {
      const lista = porRegla.get(f.ruleId) ?? [];
      lista.push(f);
      porRegla.set(f.ruleId, lista);
    }

    out.push(`Hallazgos: ${findings.length}`);
    for (const [ruleId, lista] of [...porRegla].sort((a, b) => b[1].length - a[1].length)) {
      out.push(`  ${ruleId.padEnd(16)} ${String(lista.length).padStart(4)}  ${lista[0]?.reason ?? ''}`);
      for (const f of lista.slice(0, 3)) {
        out.push(`      ${f.path}`);
      }
      if (lista.length > 3) out.push(`      y ${lista.length - 3} mas`);
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
