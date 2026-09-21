import type { AiBudget, AiBudgetAction, AiBudgetPeriod } from '@prisma/client';
import { prisma, withPlatformTx } from '../db';

/**
 * Token and cost ceilings across the hierarchy the platform actually bills on:
 * the whole deployment, one provider, a plan, a company, a feature, a person.
 *
 * The rule is "the narrowest ceiling that names you wins", not "every ceiling
 * applies". Stacking them reads well in a spec and behaves badly in practice —
 * a company that bought extra tokens would still be refused by the plan ceiling
 * it was sold an exception to. So resolution walks from the most specific match
 * to the least and stops at the first one.
 *
 * Only the `AiEvent` table is consulted for what has been spent. The older
 * `WorkspaceUsage` counters keep working exactly as they did, and
 * `assertAiBudget` keeps enforcing them: this layer adds ceilings that did not
 * exist, it does not restate the ones that did.
 */
export const BUDGET_PRECEDENCE = ['USER', 'FEATURE', 'TENANT', 'PLAN', 'PROVIDER', 'PLATFORM'] as const;

export interface BudgetSubject {
  tenantId?: string | null;
  planId?: string | null;
  provider?: string | null;
  feature?: string | null;
  userId?: string | null;
}

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

function inForce(budget: AiBudget, now: Date): boolean {
  if (!budget.enabled) return false;
  if (budget.effectiveFrom && budget.effectiveFrom > now) return false;
  if (budget.effectiveTo && budget.effectiveTo <= now) return false;
  return true;
}

/**
 * Every budget that could name this subject, most specific first. The portal
 * shows the whole list so an administrator can see which ceiling is binding and
 * which are being shadowed by a narrower one.
 */
export async function budgetsFor(subject: BudgetSubject, now: Date = new Date()): Promise<AiBudget[]> {
  const candidates: { scope: (typeof BUDGET_PRECEDENCE)[number]; scopeId: string | null; feature: string | null }[] =
    [];
  if (subject.userId) candidates.push({ scope: 'USER', scopeId: subject.userId, feature: subject.feature ?? null });
  if (subject.tenantId && subject.feature)
    candidates.push({ scope: 'TENANT', scopeId: subject.tenantId, feature: subject.feature });
  if (subject.feature) candidates.push({ scope: 'FEATURE', scopeId: subject.feature, feature: null });
  if (subject.tenantId) candidates.push({ scope: 'TENANT', scopeId: subject.tenantId, feature: null });
  if (subject.planId && subject.feature)
    candidates.push({ scope: 'PLAN', scopeId: subject.planId, feature: subject.feature });
  if (subject.planId) candidates.push({ scope: 'PLAN', scopeId: subject.planId, feature: null });
  if (subject.provider) candidates.push({ scope: 'PROVIDER', scopeId: subject.provider, feature: null });
  candidates.push({ scope: 'PLATFORM', scopeId: null, feature: null });

  const rows = await prisma.aiBudget.findMany({
    where: { enabled: true, OR: candidates.map((c) => ({ scope: c.scope, scopeId: c.scopeId, feature: c.feature })) },
  });
  const rank = (b: AiBudget) =>
    candidates.findIndex((c) => c.scope === b.scope && c.scopeId === b.scopeId && c.feature === b.feature);
  return rows.filter((b) => inForce(b, now)).sort((a, b) => rank(a) - rank(b));
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

export interface BudgetVerdict {
  allowed: boolean;
  action: AiBudgetAction | null;
  /** Set when the verdict asks the caller to drop to a cheaper step. */
  downgrade: boolean;
  state: BudgetState | null;
  message: string | null;
}

const ALLOWED = { allowed: true, action: null, downgrade: false, state: null, message: null } as const;

/**
 * The verdict for one request. `BLOCK` refuses; `CHEAPER_MODEL` lets the work
 * through on a later, cheaper step in the cascade; the rest are advisory and
 * are recorded rather than enforced here, because refusing on a rule an
 * operator set to "alert me" would be the opposite of what they asked for.
 */
export async function checkBudget(subject: BudgetSubject, now: Date = new Date()): Promise<BudgetVerdict> {
  const budgets = await budgetsFor(subject, now);
  if (!budgets.length) return { ...ALLOWED };

  // Narrowest first for *display*, but a refusal can come from any of them. The
  // first version stopped at budgets[0]: a tenant ceiling set to "alert me", not
  // yet reached, silently shadowed an exceeded platform ceiling set to BLOCK,
  // and the platform's hard limit was unenforceable the moment anyone added a
  // narrower advisory row. `enforceBudgets` in ./allowance is the request path;
  // this stays for callers that want one verdict from the display list.
  let first: BudgetState | null = null;
  for (const candidate of budgets) {
    const state = await budgetState(candidate, now);
    first ??= state;
    if (!state.exceeded) continue;
    if (candidate.action === 'BLOCK' || candidate.hardLimit) return refuse(candidate, state);
    if (candidate.action === 'CHEAPER_MODEL') {
      return { allowed: true, action: candidate.action, downgrade: true, state, message: null };
    }
  }
  return { ...ALLOWED, state: first };
}

function refuse(binding: AiBudget, state: BudgetState): BudgetVerdict {
  const scopeName = binding.feature ? `${binding.scope.toLowerCase()} ${binding.feature}` : binding.scope.toLowerCase();
  const period = binding.period === 'DAILY' ? "today's" : "this month's";
  return {
    allowed: false,
    action: 'BLOCK',
    downgrade: false,
    state,
    message: `AI is paused: ${period} ${scopeName} budget has been reached. Ask your administrator to raise it.`,
  };
}
