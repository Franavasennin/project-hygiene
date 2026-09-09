import type { Rule, MatchNode, Pack } from '../rules/schema.js';
import type { Finding, LimitHit, Inventory } from '../core/types.js';
import { evalPredicate, type EvalContext } from './predicates.js';
import type { Budget } from '../core/limits.js';

export class MalformedMatchNodeError extends Error {}

async function evalNode(node: MatchNode, ctx: EvalContext): Promise<boolean> {
  const entries = Object.entries(node);
  if (entries.length === 0) return true;
  if (entries.length > 1) {
    throw new MalformedMatchNodeError(
      `nodo match con ${entries.length} claves, se esperaba exactamente una: ${Object.keys(node).join(', ')}`,
    );
  }
  const [key, value] = entries[0]!;

  if (key === 'all') {
    for (const child of value as MatchNode[]) {
      if (!(await evalNode(child, ctx))) return false;
    }
    return true;
  }
  if (key === 'any') {
    for (const child of value as MatchNode[]) {
      if (await evalNode(child, ctx)) return true;
    }
    return false;
  }
  if (key === 'none') {
    for (const child of value as MatchNode[]) {
      if (await evalNode(child, ctx)) return false;
    }
    return true;
  }
  return evalPredicate(key, value, ctx);
}

export async function evaluateRule(rule: Rule, ctx: EvalContext): Promise<boolean> {
  return evalNode(rule.match, ctx);
}

export interface EvaluationInput {
  inventory: Inventory;
  packs: Pack[];
  budget: Budget;
  makeContext(path: string): EvalContext;
}

export interface EvaluationOutput {
  findings: Finding[];
  limits: LimitHit[];
}

/**
 * Evalua todas las reglas de todos los packs contra todo el inventario.
 *
 * Dos limitaciones aceptadas, documentadas explicitamente:
 *
 * 1. maxFilesScanned no se aplica aqui. El inventario que llega en
 *    `input.inventory.files` ya fue acotado por ese limite durante la
 *    construccion del inventario (ver src/collectors/filesystem.ts, que
 *    llama a `budget.consumeFile()` mientras recorre el arbol). Este
 *    modulo confia en que el inventario que recibe ya respeta ese tope.
 *
 * 2. El timeout por regla (`ruleExpired`) solo se comprueba entre ficheros,
 *    no durante la evaluacion de un unico fichero. Si `evalPredicate` se
 *    cuelga evaluando un solo fichero (por ejemplo una regex patologica que
 *    escapo a la guardia estatica de regex-guard.ts), este mecanismo no lo
 *    corta a mitad de evaluacion. Cortar de verdad a mitad de evaluacion
 *    exigiria aislamiento en un hilo de trabajo (worker thread) con
 *    terminacion forzosa, que queda fuera del alcance de este plan.
 */
export async function evaluateAll(input: EvaluationInput): Promise<EvaluationOutput> {
  const findings: Finding[] = [];
  const limits: LimitHit[] = [];
  let counter = 0;
  let totalTimedOut = false;

  outer:
  for (const pack of input.packs) {
    for (const rule of pack.rules) {
      if (rule.deprecated) continue;

      if (input.budget.totalExpired()) {
        totalTimedOut = true;
        limits.push({ ruleId: rule.id, limit: 'timeout_ms_total' });
        break outer;
      }

      input.budget.startRule(rule.id);
      let matches = 0;
      let stopped: string | null = null;

      for (const entry of input.inventory.files) {
        if (input.budget.ruleExpired()) { stopped = 'timeout_ms_per_rule'; break; }
        if (input.budget.totalExpired()) { stopped = 'timeout_ms_total'; totalTimedOut = true; break; }
        if (!input.budget.within('maxRuleMatches', matches)) { stopped = 'max_rule_matches'; break; }

        const ctx = input.makeContext(entry.path);
        if (!(await evaluateRule(rule, ctx))) continue;

        matches += 1;
        counter += 1;
        findings.push({
          id: `F-${String(counter).padStart(6, '0')}`,
          ruleId: rule.id,
          axis: pack.axis,
          path: entry.path,
          severity: rule.severity,
          risk: rule.risk,
          confidence: rule.confidence,
          reason: rule.title,
          evidence: { size: entry.size, mtimeMs: entry.mtimeMs, depth: entry.depth },
          suggests: rule.suggests.map((s) => s.type),
        });
      }

      if (stopped) limits.push({ ruleId: rule.id, limit: stopped });
      if (totalTimedOut) break outer;
    }
  }

  return { findings, limits };
}
