import type { AiBudget } from '@prisma/client';
import { prisma } from '../db';
import { budgetState, periodStart, spendFor, type BudgetState } from './budgets';

/**
 * One person's AI allowance: where the number came from, what it is, and how
 * much of it is gone.
 *
 * Two different questions were being answered by one table. "This company may
 * spend ten million tokens" is a ceiling over everybody's work together, and no
 * individual override should lift it. "Each person here may spend five hundred
 * thousand" is a default that a named person's override is supposed to replace.
 * `AiBudget.appliesPerUser` separates them, and this module resolves the second
 * one down the chain the operator actually thinks in:
 *
 *   platform default → subscription plan → workspace default → user override
 *
 * plus a per-feature override at the end when the request names a feature. The
 * narrowest row that exists wins outright; it is not a minimum of the chain,
 * because an override exists precisely to be larger than what it replaces.
 *
 * The rows above the allowance — the workspace's own ceiling, a provider's, the
 * platform's — are not part of this. They are separate ceilings and
 * `enforceBudgets` checks every one of them, so a company cannot be talked past
 * its own limit by handing one person a generous override.
 */
export type AllowanceSource = 'user' | 'workspace' | 'plan' | 'platform' | 'plan-limit' | 'none';

export interface Allowance {
  /** Tokens per period, null when nobody has set one anywhere in the chain. */
  tokenLimit: number | null;
  costLimit: number | null;
  period: 'DAILY' | 'MONTHLY';
  /** Which level the effective number came from. */
  source: AllowanceSource;
  /** The row the effective number came from, when it was one of ours. */
  budget: AiBudget | null;
  /** Every level that named a number, narrowest first — what the portal shows as inherited. */
  chain: { source: AllowanceSource; tokenLimit: number | null; costLimit: number | null; budgetId: string | null }[];
  /** True when an explicit row for this person replaced what they would have inherited. */
  overridden: boolean;
  /** Set when the effective row says this person may make no AI request at all. */
  disabled: boolean;
}

function inForce(budget: AiBudget, now: Date): boolean {
  if (!budget.enabled) return false;
  if (budget.effectiveFrom && budget.effectiveFrom > now) return false;
  if (budget.effectiveTo && budget.effectiveTo <= now) return false;
  return true;
}

const num = (v: bigint | null) => (v === null ? null : Number(v));

/**
 * The plan's per-user token limit, which predates this table and is still the
 * answer for every deployment that has configured nothing here. Read from the
 * same `PlanLimit` key `lib/ai/usage.ts` enforces, so the two cannot disagree.
 */
const PLAN_USER_TOKEN_KEY = 'ai_tokens:user';

async function planUserLimit(tenantId: string): Promise<{ planId: string | null; tokens: number | null }> {
  const subscription = await prisma.tenantSubscription.findUnique({
    where: { tenantId },
    select: {
      planId: true,
      plan: { select: { planLimits: { where: { key: PLAN_USER_TOKEN_KEY }, select: { value: true } } } },
    },
  });
  const value = subscription?.plan?.planLimits[0]?.value;
  return {
    planId: subscription?.planId ?? null,
    tokens: typeof value === 'number' && value > 0 ? value : null,
  };
}

/**
 * Resolve one person's allowance. `feature` narrows it to a per-feature
 * override when the caller has one in mind; omit it for the person's overall
 * number, which is what the console shows.
 */
export async function allowanceFor(
  tenantId: string,
  userId: string,
  feature?: string | null,
  now: Date = new Date(),
): Promise<Allowance> {
  const { planId, tokens: planTokens } = await planUserLimit(tenantId);

  const rows = await prisma.aiBudget.findMany({
    where: {
      enabled: true,
      OR: [
        { scope: 'USER', scopeId: userId },
        { scope: 'TENANT', scopeId: tenantId, appliesPerUser: true },
        ...(planId ? [{ scope: 'PLAN' as const, scopeId: planId, appliesPerUser: true }] : []),
        { scope: 'PLATFORM', scopeId: null, appliesPerUser: true },
      ],
    },
  });
  const live = rows.filter((b) => inForce(b, now));

  const pick = (match: (b: AiBudget) => boolean): AiBudget | null => live.find(match) ?? null;

  // Narrowest first. A user row naming this feature beats the user's general
  // row, which beats the workspace default, and so on down.
  const candidates: { source: AllowanceSource; budget: AiBudget | null; tokens: number | null; cost: number | null }[] =
    [];
  const userFeature = feature ? pick((b) => b.scope === 'USER' && b.feature === feature) : null;
  const userGeneral = pick((b) => b.scope === 'USER' && b.feature === null);
  const workspace =
    pick((b) => b.scope === 'TENANT' && b.appliesPerUser && b.feature === (feature ?? null)) ??
    pick((b) => b.scope === 'TENANT' && b.appliesPerUser && b.feature === null);
  const plan = pick((b) => b.scope === 'PLAN' && b.appliesPerUser);
  const platform = pick((b) => b.scope === 'PLATFORM' && b.appliesPerUser);

  for (const [source, budget] of [
    ['user', userFeature],
    ['user', userGeneral],
    ['workspace', workspace],
    ['plan', plan],
    ['platform', platform],
  ] as const) {
    if (budget)
      candidates.push({
        source,
        budget,
        tokens: num(budget.tokenLimit),
        cost: budget.costLimit === null ? null : Number(budget.costLimit),
      });
  }
  // The plan's own PlanLimit row sits below everything the console can write,
  // so a deployment that has set nothing here still has the number it always had.
  if (planTokens !== null) candidates.push({ source: 'plan-limit', budget: null, tokens: planTokens, cost: null });

  const effective = candidates[0] ?? null;
  const chain = candidates.map((c) => ({
    source: c.source,
    tokenLimit: c.tokens,
    costLimit: c.cost,
    budgetId: c.budget?.id ?? null,
  }));

  return {
    tokenLimit: effective?.tokens ?? null,
    costLimit: effective?.cost ?? null,
    period: (effective?.budget?.period ?? 'MONTHLY') as 'DAILY' | 'MONTHLY',
    source: effective?.source ?? 'none',
    budget: effective?.budget ?? null,
    chain,
    overridden: Boolean(userFeature ?? userGeneral),
    // A zero allowance is how "AI off for this person" is written: it is a
    // limit like any other, so nothing downstream needs a second concept.
    disabled: effective?.tokens === 0,
  };
}

/** What this person has spent in the allowance's period. */
export async function usageFor(
  tenantId: string,
  userId: string,
  period: 'DAILY' | 'MONTHLY' = 'MONTHLY',
  feature?: string | null,
  now: Date = new Date(),
): Promise<{ tokens: number; inputTokens: number; outputTokens: number; micros: bigint; requests: number }> {
  const since = periodStart(period, now);
  const agg = await prisma.aiEvent.aggregate({
    where: { tenantId, userId, occurredAt: { gte: since }, ...(feature ? { feature } : {}) },
    _count: { _all: true },
    _sum: { inputTokens: true, outputTokens: true, costMicros: true },
  });
  const input = agg._sum.inputTokens ?? 0;
  const output = agg._sum.outputTokens ?? 0;
  return {
    tokens: input + output,
    inputTokens: input,
    outputTokens: output,
    micros: agg._sum.costMicros ?? 0n,
    requests: agg._count._all,
  };
}

export type UsageStatus = 'normal' | 'warning' | 'critical' | 'limit-reached' | 'disabled' | 'no-limit';

/** The word a console row shows, from the percentage and the thresholds. */
export function usageStatus(percent: number | null, disabled: boolean, thresholds = [70, 85, 95]): UsageStatus {
  if (disabled) return 'disabled';
  if (percent === null) return 'no-limit';
  const sorted = [...thresholds].sort((a, b) => a - b);
  if (percent >= 100) return 'limit-reached';
  if (percent >= (sorted[sorted.length - 1] ?? 95)) return 'critical';
  if (percent >= (sorted[0] ?? 70)) return 'warning';
  return 'normal';
}

export interface AllowanceState extends Allowance {
  usedTokens: number;
  inputTokens: number;
  outputTokens: number;
  usedMicros: bigint;
  requests: number;
  remaining: number | null;
  percent: number | null;
  status: UsageStatus;
}

export async function allowanceState(
  tenantId: string,
  userId: string,
  feature?: string | null,
  now: Date = new Date(),
): Promise<AllowanceState> {
  const allowance = await allowanceFor(tenantId, userId, feature, now);
  const used = await usageFor(tenantId, userId, allowance.period, feature, now);
  const byTokens = allowance.tokenLimit ? used.tokens / allowance.tokenLimit : null;
  const byCost = allowance.costLimit ? Number(used.micros) / (allowance.costLimit * 1_000_000) : null;
  const ratio = byTokens === null ? byCost : byCost === null ? byTokens : Math.max(byTokens, byCost);
  const percent = ratio === null ? null : Math.round(ratio * 1000) / 10;
  return {
    ...allowance,
    usedTokens: used.tokens,
    inputTokens: used.inputTokens,
    outputTokens: used.outputTokens,
    usedMicros: used.micros,
    requests: used.requests,
    remaining: allowance.tokenLimit === null ? null : Math.max(0, allowance.tokenLimit - used.tokens),
    percent,
    status: usageStatus(percent, allowance.disabled, allowance.budget?.thresholds ?? [70, 85, 95]),
  };
}

export interface EnforcementVerdict {
  allowed: boolean;
  /** Which ceiling refused, in the vocabulary the event table records. */
  level: 'platform' | 'provider' | 'workspace' | 'user' | 'feature' | null;
  action: AiBudget['action'] | null;
  /** True when the caller should drop to a cheaper step rather than refuse. */
  downgrade: boolean;
  message: string | null;
  state: BudgetState | null;
}

const ALLOWED: EnforcementVerdict = {
  allowed: true,
  level: null,
  action: null,
  downgrade: false,
  message: null,
  state: null,
};

/**
 * Every ceiling that stands between this request and the provider, checked in
 * the order an operator would name them: the platform's, the provider's, the
 * company's, the person's, then the feature's.
 *
 * Not "the narrowest one wins" — that is right for resolving *an allowance* and
 * wrong for enforcement. A company sold a larger allowance for one salesperson
 * has not bought a larger company ceiling, and the ceiling has to keep refusing
 * once the company as a whole is out, whatever any individual row says.
 *
 * The first ceiling that refuses ends it. An `ALERT_ONLY` ceiling never refuses;
 * `CHEAPER_MODEL` lets the work through on a later step of the cascade.
 */
export async function enforceBudgets(
  subject: { tenantId?: string | null; userId?: string | null; feature: string; provider?: string | null },
  now: Date = new Date(),
): Promise<EnforcementVerdict> {
  const aggregates: { level: EnforcementVerdict['level']; where: Parameters<typeof prisma.aiBudget.findFirst>[0] }[] = [
    { level: 'platform', where: { where: { scope: 'PLATFORM', scopeId: null, appliesPerUser: false, enabled: true } } },
    ...(subject.provider
      ? [
          {
            level: 'provider' as const,
            where: { where: { scope: 'PROVIDER' as const, scopeId: subject.provider, enabled: true } },
          },
        ]
      : []),
    ...(subject.tenantId
      ? [
          {
            level: 'workspace' as const,
            where: {
              where: {
                scope: 'TENANT' as const,
                scopeId: subject.tenantId,
                feature: null,
                appliesPerUser: false,
                enabled: true,
              },
            },
          },
        ]
      : []),
  ];

  for (const { level, where } of aggregates) {
    const budget = (await prisma.aiBudget.findFirst(where)) as AiBudget | null;
    if (!budget || !inForce(budget, now)) continue;
    const state = await budgetState(budget, now);
    if (!state.exceeded) continue;
    const verdict = decide(budget, level, state, now);
    if (verdict) return verdict;
  }

  // The person's own allowance, resolved down the inheritance chain.
  if (subject.tenantId && subject.userId) {
    const state = await allowanceState(subject.tenantId, subject.userId, null, now);
    if (state.disabled) {
      return {
        allowed: false,
        level: 'user',
        action: 'BLOCK',
        downgrade: false,
        message: 'AI is switched off for this account. Ask your administrator to turn it back on.',
        state: null,
      };
    }
    if (state.percent !== null && state.percent >= 100) {
      const action = state.budget?.action ?? 'BLOCK';
      if (action === 'BLOCK' || state.budget?.hardLimit) {
        return {
          allowed: false,
          level: 'user',
          action: 'BLOCK',
          downgrade: false,
          message: `You have used your AI allowance for this ${state.period === 'DAILY' ? 'day' : 'month'}. Ask your administrator to raise it.`,
          state: null,
        };
      }
      if (action === 'CHEAPER_MODEL') return { ...ALLOWED, level: 'user', action, downgrade: true };
    }
  }

  // A feature ceiling last: the narrowest thing an operator can cap.
  const featureWheres = [
    ...(subject.tenantId
      ? [
          {
            scope: 'TENANT' as const,
            scopeId: subject.tenantId,
            feature: subject.feature,
            appliesPerUser: false,
            enabled: true,
          },
        ]
      : []),
    { scope: 'FEATURE' as const, scopeId: subject.feature, enabled: true },
  ];
  for (const where of featureWheres) {
    const budget = (await prisma.aiBudget.findFirst({ where })) as AiBudget | null;
    if (!budget || !inForce(budget, now)) continue;
    const state = await budgetState(budget, now);
    if (!state.exceeded) continue;
    const verdict = decide(budget, 'feature', state, now);
    if (verdict) return verdict;
  }

  return { ...ALLOWED };
}

function decide(
  budget: AiBudget,
  level: EnforcementVerdict['level'],
  state: BudgetState,
  _now: Date,
): EnforcementVerdict | null {
  if (budget.action === 'BLOCK' || budget.hardLimit) {
    const period = budget.period === 'DAILY' ? "today's" : "this month's";
    const name =
      level === 'platform'
        ? 'the platform AI budget'
        : level === 'provider'
          ? `the ${budget.scopeId} budget`
          : level === 'workspace'
            ? "this workspace's AI budget"
            : `the ${budget.feature ?? budget.scopeId} budget`;
    return {
      allowed: false,
      level,
      action: 'BLOCK',
      downgrade: false,
      message: `AI is paused: ${period} spend has reached ${name}. Ask your administrator to raise it.`,
      state,
    };
  }
  if (budget.action === 'CHEAPER_MODEL') {
    return { ...ALLOWED, level, action: budget.action, downgrade: true, state };
  }
  // ALERT_ONLY, DISABLE_OPTIONAL and REQUIRE_APPROVAL are recorded, not enforced
  // here: refusing on a rule an operator set to "tell me" is the opposite of
  // what they asked for, and the other two need a surface that does not exist yet.
  return null;
}

/** Everything the per-user spend/usage helpers need, kept in one place. */
export async function workspaceSpend(
  tenantId: string,
  period: 'DAILY' | 'MONTHLY' = 'MONTHLY',
  now: Date = new Date(),
) {
  const since = periodStart(period, now);
  const [agg, users, byFeature, byModel, fallbacks, last] = await Promise.all([
    prisma.aiEvent.aggregate({
      where: { tenantId, occurredAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, costMicros: true },
    }),
    prisma.aiEvent.groupBy({
      by: ['userId'],
      where: { tenantId, occurredAt: { gte: since }, userId: { not: null } },
      _sum: { inputTokens: true, outputTokens: true, costMicros: true },
      _count: { _all: true },
    }),
    prisma.aiEvent.groupBy({
      by: ['feature'],
      where: { tenantId, occurredAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true, costMicros: true },
      _count: { _all: true },
    }),
    prisma.aiEvent.groupBy({
      by: ['provider', 'model'],
      where: { tenantId, occurredAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true },
      _count: { _all: true },
    }),
    prisma.aiEvent.count({ where: { tenantId, occurredAt: { gte: since }, outcome: 'FELL_BACK' } }),
    prisma.aiEvent.findFirst({
      where: { tenantId },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    }),
  ]);
  return { agg, users, byFeature, byModel, fallbacks, lastActivityAt: last?.occurredAt ?? null, since };
}

export { spendFor };
