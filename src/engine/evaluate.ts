import type { Rule, MatchNode, Pack } from '../rules/schema.js';
import type { Finding, LimitHit, Inventory } from '../core/types.js';
import { evalPredicate, type EvalContext } from './predicates.js';
import type { Budget } from '../core/limits.js';

async function evalNode(node: MatchNode, ctx: EvalContext): Promise<boolean> {
  const first = Object.entries(node)[0];
  if (!first) return true;
  const [key, value] = first;

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

export async function evaluateAll(input: EvaluationInput): Promise<EvaluationOutput> {
  const findings: Finding[] = [];
  const limits: LimitHit[] = [];
  let counter = 0;

  for (const pack of input.packs) {
    for (const rule of pack.rules) {
      if (rule.deprecated) continue;
      input.budget.startRule(rule.id);
      let matches = 0;
      let stopped: string | null = null;

      for (const entry of input.inventory.files) {
        if (input.budget.ruleExpired()) { stopped = 'timeout_ms_per_rule'; break; }
        if (input.budget.totalExpired()) { stopped = 'timeout_ms_total'; break; }
        if (matches >= input.budget.limits.maxRuleMatches) { stopped = 'max_rule_matches'; break; }

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
    }
  }

  return { findings, limits };
}
