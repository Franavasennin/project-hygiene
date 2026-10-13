import type { HygieneConfig } from './config/load.js';
import { runPlan, type PlanRun } from './plan.js';
import { runClean } from './clean.js';
import { EXECUTABLE_TYPES } from './planner/plan.js';
import { loadApprovals, saveApprovals } from './approvals/store.js';
import { mergeApproval } from './approvals/approve.js';

export interface LoopOptions {
  root: string;
  rulesDir: string;
  home: string;
  config: HygieneConfig;
  now?: () => Date;
}

export type LoopStop = 'no-operations' | 'no-improvement' | 'regression' | 'max-iterations' | 'stale' | 'failed';

export interface LoopIteration {
  n: number;
  scoreBefore: number;
  scoreAfter: number;
  executed: number;
}

export interface LoopResult {
  iterations: LoopIteration[];
  stop: LoopStop;
  scoreInitial: number;
  scoreFinal: number;
}

/**
 * AUDIT -> SCORE -> PLAN -> APPROVAL POLICY -> EXECUTE -> VALIDATE -> COMPARE
 * (spec §11). La politica se materializa como aprobaciones concretas en
 * ~/.hygiene/approvals/ (decision 12). Nunca persigue el 100 por si mismo.
 */
export async function runLoop(o: LoopOptions): Promise<LoopResult> {
  const now = o.now ?? (() => new Date());
  const planOptions = {
    root: o.root,
    rulesDir: o.rulesDir,
    limits: o.config.limits,
    minConfidence: o.config.minConfidence,
    defaultBranch: o.config.defaultBranch,
  };
  const requires = new Set(o.config.loop.requireApprovalForRisk);
  const iterations: LoopIteration[] = [];

  let current: PlanRun = await runPlan(planOptions);
  const scoreInitial = current.audit.score.total;
  const done = (stop: LoopStop): LoopResult => ({
    iterations, stop, scoreInitial, scoreFinal: current.audit.score.total,
  });

  for (let n = 1; n <= o.config.loop.maxIterations; n++) {
    const auto = current.plan.operations.filter((op) =>
      EXECUTABLE_TYPES.has(op.type) && op.risk !== 'unknown' && !requires.has(op.risk));
    if (auto.length === 0) return done('no-operations');

    const record = mergeApproval(
      await loadApprovals(o.home, o.root),
      current.plan,
      auto,
      ['loop', `politica: requieren aprobacion ${[...requires].join(', ')}`],
      now(),
    );
    await saveApprovals(o.home, record);

    const clean = await runClean({ ...planOptions, home: o.home, now: now() });
    if (clean.status === 'stale') return done('stale');
    if (clean.status === 'no-approvals') return done('no-operations');

    const executed = clean.outcomes.filter((x) => x.status === 'quarantined' || x.status === 'applied').length;
    const next = await runPlan(planOptions);
    const before = current.audit.score.total;
    const after = next.audit.score.total;
    iterations.push({ n, scoreBefore: before, scoreAfter: after, executed });
    current = next;

    if (clean.outcomes.some((x) => x.status === 'failed')) return done('failed');
    if (after < before && o.config.loop.stopOnRegression) return done('regression');
    if (after <= before && o.config.loop.stopIfNoImprovement) return done('no-improvement');
  }
  return done('max-iterations');
}
