import type { Axis, Finding, LimitHit, Score, Severity } from '../core/types.js';
import { ENGINE_VERSION, SCORE_PROFILE } from '../core/version.js';

const WEIGHT: Record<Axis, number> = {
  filesystem: 30, git: 25, security: 30, ai: 15,
};

const SATURATION: Record<Axis, number> = {
  filesystem: 60, git: 40, security: 40, ai: 30,
};

const SEVERITY_WEIGHT: Record<Severity, number> = {
  info: 0, low: 1, medium: 3, high: 8, critical: 20,
};

const CRITICAL_CAP = 59;

export function computeScore(findings: Finding[], limits: LimitHit[]): Score {
  const perRule = new Map<string, { axis: Axis; severity: Severity; n: number }>();
  for (const f of findings) {
    const hit = perRule.get(f.ruleId);
    if (hit) hit.n += 1;
    else perRule.set(f.ruleId, { axis: f.axis, severity: f.severity, n: 1 });
  }

  const penalty: Record<Axis, number> = { filesystem: 0, git: 0, security: 0, ai: 0 };
  for (const { axis, severity, n } of perRule.values()) {
    penalty[axis] += SEVERITY_WEIGHT[severity] * Math.sqrt(n);
  }

  const axes = {} as Record<Axis, number>;
  let total = 0;
  for (const axis of Object.keys(WEIGHT) as Axis[]) {
    const value = WEIGHT[axis] * Math.max(0, 1 - penalty[axis] / SATURATION[axis]);
    const rounded = Math.round(value * 100) / 100;
    axes[axis] = rounded;
    total += rounded;
  }
  total = Math.round(total * 100) / 100;
  // Redondeamos total a 2 decimales, igual que cada eje individual, en vez de
  // a entero. Redondear a entero (Math.round simple) colapsa deltas pequenos
  // que caen justo en un limite .5 (99.5 -> 100), borrando por completo la
  // penalizacion de un unico hallazgo de severidad baja. Redondear a 2
  // decimales preserva esa penalizacion visible y ademas garantiza que total
  // sea exactamente la suma de los axes mostrados, sin ruido de coma flotante.

  const blockers: string[] = [];

  const criticals = findings.filter((f) => f.severity === 'critical');
  if (criticals.length > 0) {
    total = Math.min(total, CRITICAL_CAP);
    blockers.push(`${criticals.length} hallazgo(s) critical`);
  }

  const unknowns = findings.filter((f) => f.risk === 'unknown');
  if (unknowns.length > 0) {
    blockers.push(`${unknowns.length} hallazgo(s) con riesgo unknown`);
  }

  for (const l of limits) {
    blockers.push(`RULE_EXECUTION_LIMIT ${l.ruleId} (${l.limit})`);
  }

  return {
    profile: SCORE_PROFILE,
    engineVersion: ENGINE_VERSION,
    total,
    axes,
    clean: blockers.length === 0,
    blockers,
  };
}
