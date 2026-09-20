import { prisma, withPlatformTx } from '@/lib/db';
import { budgetState, type BudgetState } from '@/lib/ai/budgets';
import { effectiveGuardrails, GUARDRAILS, type GuardrailKey } from '@/lib/ai/guardrails';
import { AI_FEATURES, AI_PROVIDERS, featureLabel } from '@/lib/ai/features';
import { microsToAmount } from '@/lib/ai/pricing';
import { routeFor, type RouteStep } from '@/lib/ai/routing';

/**
 * Everything the AI Control Center shows, read in one pass.
 *
 * The page authorizes, this reads, the view renders — the split `ai-usage`
 * already uses, and for the same reason: a module that can produce the whole
 * protected page must not also be a route.
 */
export interface PriceRow {
  id: string;
  provider: string;
  model: string;
  inputPerM: number;
  outputPerM: number;
  currency: string;
  effectiveFrom: string;
  current: boolean;
}

export interface BudgetRow {
  id: string;
  scope: string;
  scopeId: string | null;
  scopeLabel: string;
  feature: string | null;
  tokenLimit: number | null;
  costLimit: number | null;
  currency: string;
  period: string;
  thresholds: number[];
  action: string;
  hardLimit: boolean;
  enabled: boolean;
  usedTokens: number;
  usedAmount: number;
  percent: number | null;
  exceeded: boolean;
}

export interface GuardrailRow {
  key: GuardrailKey;
  label: string;
  help: string;
  locked: boolean;
  enabled: boolean;
  config: Record<string, number>;
  source: string;
}

export interface RouteRow {
  feature: string;
  label: string;
  strategy: string;
  steps: RouteStep[];
  triggers: string[];
  deterministicFallback: boolean;
  enabled: boolean;
  configured: boolean;
}

export interface FeatureSpend {
  feature: string;
  label: string;
  requests: number;
  tokens: number;
  amount: number;
  failures: number;
  fallbacks: number;
}

export interface AiControlData {
  prices: PriceRow[];
  budgets: BudgetRow[];
  guardrails: GuardrailRow[];
  routes: RouteRow[];
  features: { key: string; label: string }[];
  providers: string[];
  models: string[];
  summary: {
    days: number;
    requests: number;
    tokens: number;
    amount: number;
    currency: string;
    failures: number;
    fallbacks: number;
    blocked: number;
    unpriced: number;
  };
  bySpend: FeatureSpend[];
  recentBlocks: {
    id: string;
    feature: string;
    kind: string;
    reason: string | null;
    occurredAt: string;
    tenantId: string | null;
  }[];
}

const WINDOW_DAYS = 30;

function scopeLabel(scope: string, scopeId: string | null, names: Map<string, string>): string {
  if (scope === 'PLATFORM') return 'Whole platform';
  if (!scopeId) return scope;
  return names.get(scopeId) ?? scopeId;
}

export async function loadAiControl(): Promise<AiControlData> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // AiEvent is under FORCE row-level security; the console reads every
  // company's rows at once, so the aggregates run inside withPlatformTx or come
  // back empty. The configuration tables beside it carry no tenantId and need
  // no transaction. Same shape as `ai-usage/data.ts`, same reason.
  const [priceRows, budgetRows, routeRows] = await Promise.all([
    prisma.aiModelPrice.findMany({ orderBy: [{ provider: 'asc' }, { model: 'asc' }, { effectiveFrom: 'desc' }] }),
    prisma.aiBudget.findMany({ orderBy: [{ scope: 'asc' }, { createdAt: 'asc' }] }),
    prisma.aiRoute.findMany({ orderBy: { feature: 'asc' } }),
  ]);

  const stats = await withPlatformTx(async (tx) => {
    const within = { occurredAt: { gte: since } };
    const [events, byFeature, blocks, unpriced, failures, fallbacks, blocked, outcomes] = await Promise.all([
      tx.aiEvent.aggregate({
        where: within,
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, costMicros: true },
      }),
      tx.aiEvent.groupBy({
        by: ['feature'],
        where: within,
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, costMicros: true },
      }),
      tx.aiEvent.findMany({
        where: { ...within, outcome: { in: ['BLOCKED', 'FAILED'] } },
        orderBy: { occurredAt: 'desc' },
        take: 25,
        select: { id: true, feature: true, kind: true, reason: true, occurredAt: true, tenantId: true },
      }),
      tx.aiEvent.count({ where: { ...within, priceId: null, outcome: 'OK' } }),
      tx.aiEvent.count({ where: { ...within, outcome: 'FAILED' } }),
      tx.aiEvent.count({ where: { ...within, outcome: 'FELL_BACK' } }),
      tx.aiEvent.count({ where: { ...within, outcome: 'BLOCKED' } }),
      // Per-feature failure and fallback counts, so a row can say "12 of these
      // fell back" rather than only naming the total.
      tx.aiEvent.groupBy({
        by: ['feature', 'outcome'],
        where: { ...within, outcome: { in: ['FAILED', 'FELL_BACK'] } },
        _count: { _all: true },
      }),
    ]);
    return { events, byFeature, blocks, unpriced, failures, fallbacks, blocked, outcomes };
  });
  const { events, byFeature, blocks, unpriced, failures, fallbacks, blocked } = stats;
  const outcomeOf = (feature: string, outcome: string) =>
    stats.outcomes.find((o) => o.feature === feature && o.outcome === outcome)?._count._all ?? 0;

  // Names for the scopes a budget can point at, so the table reads in words.
  const tenantIds = budgetRows.filter((b) => b.scope === 'TENANT').map((b) => b.scopeId!);
  const planIds = budgetRows.filter((b) => b.scope === 'PLAN').map((b) => b.scopeId!);
  const userIds = budgetRows.filter((b) => b.scope === 'USER').map((b) => b.scopeId!);
  const [tenants, plans, users] = await Promise.all([
    tenantIds.length
      ? prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, displayName: true } })
      : [],
    planIds.length
      ? prisma.subscriptionPlan.findMany({ where: { id: { in: planIds } }, select: { id: true, name: true } })
      : [],
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
      : [],
  ]);
  const names = new Map<string, string>([
    ...tenants.map((t) => [t.id, t.displayName] as [string, string]),
    ...plans.map((p) => [p.id, `${p.name} plan`] as [string, string]),
    ...users.map((u) => [u.id, u.fullName ?? u.id] as [string, string]),
    ...AI_FEATURES.map((f) => [f.key, f.label] as [string, string]),
    ...AI_PROVIDERS.map((p) => [p, p] as [string, string]),
  ]);

  const states = new Map<string, BudgetState>();
  for (const budget of budgetRows) states.set(budget.id, await budgetState(budget));

  const guardrails = await effectiveGuardrails(null, null);

  const seenCurrent = new Set<string>();
  const prices: PriceRow[] = priceRows.map((row) => {
    const key = `${row.provider}|${row.model}`;
    const current = row.effectiveFrom <= new Date() && !seenCurrent.has(key);
    if (current) seenCurrent.add(key);
    return {
      id: row.id,
      provider: row.provider,
      model: row.model,
      inputPerM: Number(row.inputPerM),
      outputPerM: Number(row.outputPerM),
      currency: row.currency,
      effectiveFrom: row.effectiveFrom.toISOString(),
      current,
    };
  });

  const routes: RouteRow[] = [];
  for (const feature of AI_FEATURES) {
    const row = routeRows.find((r) => r.feature === feature.key);
    const resolved = await routeFor(feature.key);
    routes.push({
      feature: feature.key,
      label: feature.label,
      strategy: row?.strategy ?? 'BALANCED',
      steps: resolved.steps,
      triggers: resolved.triggers,
      deterministicFallback: resolved.deterministicFallback,
      enabled: row?.enabled ?? true,
      configured: resolved.configured,
    });
  }

  return {
    prices,
    budgets: budgetRows.map((b) => {
      const state = states.get(b.id)!;
      return {
        id: b.id,
        scope: b.scope,
        scopeId: b.scopeId,
        scopeLabel: scopeLabel(b.scope, b.scopeId, names),
        feature: b.feature,
        tokenLimit: b.tokenLimit === null ? null : Number(b.tokenLimit),
        costLimit: b.costLimit === null ? null : Number(b.costLimit),
        currency: b.currency,
        period: b.period,
        thresholds: b.thresholds,
        action: b.action,
        hardLimit: b.hardLimit,
        enabled: b.enabled,
        usedTokens: state.usedTokens,
        usedAmount: microsToAmount(state.usedMicros),
        percent: state.percent,
        exceeded: state.exceeded,
      };
    }),
    guardrails: GUARDRAILS.map((def) => {
      const live = guardrails.get(def.key)!;
      return {
        key: def.key,
        label: def.label,
        help: def.help,
        locked: def.locked,
        enabled: live.enabled,
        config: live.config,
        source: live.source,
      };
    }),
    routes,
    features: AI_FEATURES.map((f) => ({ key: f.key, label: f.label })),
    providers: [...AI_PROVIDERS],
    models: [...new Set(priceRows.map((p) => p.model))].sort(),
    summary: {
      days: WINDOW_DAYS,
      requests: events._count._all,
      tokens: (events._sum.inputTokens ?? 0) + (events._sum.outputTokens ?? 0),
      amount: microsToAmount(events._sum.costMicros ?? 0n),
      currency: 'USD',
      failures,
      fallbacks,
      blocked,
      unpriced,
    },
    bySpend: byFeature
      .map((row) => ({
        feature: row.feature,
        label: featureLabel(row.feature),
        requests: row._count._all,
        tokens: (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0),
        amount: microsToAmount(row._sum.costMicros ?? 0n),
        failures: outcomeOf(row.feature, 'FAILED'),
        fallbacks: outcomeOf(row.feature, 'FELL_BACK'),
      }))
      .sort((a, b) => b.amount - a.amount || b.tokens - a.tokens),
    recentBlocks: blocks.map((b) => ({
      id: b.id,
      feature: featureLabel(b.feature),
      kind: b.kind,
      reason: b.reason,
      occurredAt: b.occurredAt.toISOString(),
      tenantId: b.tenantId,
    })),
  };
}
