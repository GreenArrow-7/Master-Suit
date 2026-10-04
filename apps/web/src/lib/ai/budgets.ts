import type { AiBudget, AiBudgetPeriod } from '@prisma/client';
import { withPlatformTx } from '../db';

/**
 * Token and cost ceilings across the hierarchy the platform actually bills on:
 * the whole deployment, one provider, a plan, a company, a feature, a person.
 *
 * The rule is "the narrowest ceiling that names you wins", not "every ceiling
 * applies". Stacking them reads well in a spec and behaves badly in practice —
 * a company that bought extra tokens would still be refused by the plan ceiling
 * it was sold an exception to. `enforceBudgets` in ./allowance resolves and
 * enforces them, narrowest first; this file measures what a budget has spent.
 *
 * Only the `AiEvent` table is consulted for what has been spent. The older
 * `WorkspaceUsage` counters keep working exactly as they did, and
 * `assertAiBudget` keeps enforcing them: this layer adds ceilings that did not
 * exist, it does not restate the ones that did.
 */
export interface BudgetState {
  budget: AiBudget;
  usedTokens: number;
  usedMicros: bigint;
  /** 0–100+, against whichever limit the budget sets; null when it sets neither. */
  percent: number | null;
  exceeded: boolean;
  /** The highest configured threshold this spend has passed, if any. */
  thresholdPassed: number | null;
  periodStart: Date;
}

/** The window a period covers, counted from `now` in UTC. */
export function periodStart(period: AiBudgetPeriod, now: Date = new Date()): Date {
  return period === 'DAILY'
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** What this budget's scope has spent in the current period. */
export async function spendFor(budget: AiBudget, now: Date = new Date()): Promise<{ tokens: number; micros: bigint }> {
  const since = periodStart(budget.period, now);
  const where: Record<string, unknown> = { occurredAt: { gte: since } };
  if (budget.feature) where.feature = budget.feature;
  if (budget.scope === 'TENANT') where.tenantId = budget.scopeId;
  if (budget.scope === 'USER') where.userId = budget.scopeId;
  if (budget.scope === 'FEATURE') where.feature = budget.scopeId;
  if (budget.scope === 'PROVIDER') where.provider = budget.scopeId;
  if (budget.scope === 'PLAN') {
    // Inside the platform transaction with the aggregate below, not beside it:
    // TenantSubscription is tenant-owned, this read names every subscriber of a
    // plan on purpose, and outside withPlatformTx the tenant guard refuses it
    // outright — which took the console down and, through checkBudget, failed
    // the customer's AI request as well.
    const tenants = await withPlatformTx((tx) =>
      tx.tenantSubscription.findMany({ where: { planId: budget.scopeId ?? '' }, select: { tenantId: true } }),
    );
    where.tenantId = { in: tenants.map((t) => t.tenantId) };
  }

  // AiEvent is under FORCE row-level security and a budget deliberately spans
  // more than one company's rows — a plan ceiling covers every subscriber, a
  // platform ceiling covers everyone. Outside withPlatformTx the policy matches
  // an unset tenant setting and the sum comes back zero, which reads as "no
  // spend" rather than as a query that could not see anything.
  const agg = await withPlatformTx((tx) =>
    tx.aiEvent.aggregate({ where, _sum: { inputTokens: true, outputTokens: true, costMicros: true } }),
  );
  return {
    tokens: (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0),
    micros: agg._sum.costMicros ?? 0n,
  };
}

export async function budgetState(budget: AiBudget, now: Date = new Date()): Promise<BudgetState> {
  const { tokens, micros } = await spendFor(budget, now);
  // A ceiling of zero is "no AI here", the strictest thing an operator can set,
  // and 0/0 is NaN — which is not >= 100, so the strictest setting was the one
  // that never bound. Zero is treated as reached the moment it exists.
  const ratioAgainst = (used: number, limit: number) => (limit > 0 ? used / limit : used >= 0 ? Infinity : 0);
  const byTokens = budget.tokenLimit !== null ? ratioAgainst(Number(tokens), Number(budget.tokenLimit)) : null;
  const byCost = budget.costLimit !== null ? ratioAgainst(Number(micros), Number(budget.costLimit) * 1_000_000) : null;
  // Whichever ceiling is closer to being reached is the one that binds.
  const ratio = byTokens === null ? byCost : byCost === null ? byTokens : Math.max(byTokens, byCost);
  const percent = ratio === null ? null : ratio === Infinity ? 100 : Math.round(ratio * 1000) / 10;
  const passed = [...budget.thresholds].sort((a, b) => a - b).filter((t) => percent !== null && percent >= t);
  return {
    budget,
    usedTokens: tokens,
    usedMicros: micros,
    percent,
    exceeded: percent !== null && percent >= 100,
    thresholdPassed: passed.length ? passed[passed.length - 1]! : null,
    periodStart: periodStart(budget.period, now),
  };
}
