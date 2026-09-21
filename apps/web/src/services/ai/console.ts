import { prisma, withPlatformTx } from '@/lib/db';
import { AI_FEATURES, featureLabel } from '@/lib/ai/features';
import { microsToAmount } from '@/lib/ai/pricing';
import { periodStart } from '@/lib/ai/budgets';
import { allowanceState, usageStatus, type AllowanceState, type UsageStatus } from '@/lib/ai/allowance';

/**
 * What the AI Control Center shows about a company and the people inside it.
 *
 * Every figure comes from `AiEvent`, one row per AI attempt, so a number on a
 * screen can always be traced to the requests that produced it. Nothing here is
 * estimated from a monthly counter: the counters still exist and still enforce
 * the older plan ceilings, but they cannot answer "which person, which feature,
 * which model", which is the whole question this console is for.
 *
 * All of it is cross-tenant by nature — the platform operator is looking at
 * somebody else's workspace — so every read runs inside `withPlatformTx`. A
 * company administrator reaching these functions would see their own tenant and
 * nothing else, because the loaders take the tenant as an argument and the
 * routes above them are platform-owner only.
 */
const nz = (v: number | null | undefined) => v ?? 0;

export interface WorkspaceRow {
  tenantId: string;
  name: string;
  slug: string;
  planName: string | null;
  tokenLimit: number | null;
  usedTokens: number;
  remaining: number | null;
  percent: number | null;
  inputTokens: number;
  outputTokens: number;
  amount: number;
  activeUsers: number;
  topUser: { userId: string; name: string; tokens: number } | null;
  topFeature: { feature: string; label: string; tokens: number } | null;
  topModel: { provider: string; model: string; requests: number } | null;
  fallbacks: number;
  status: UsageStatus;
  lastActivityAt: string | null;
}

/** Every workspace with AI activity or an AI budget, heaviest first. */
export async function loadWorkspaces(now: Date = new Date()): Promise<{ rows: WorkspaceRow[]; since: string }> {
  const since = periodStart('MONTHLY', now);

  const { byTenant, byTenantUser, byTenantFeature, byTenantModel, fallbacks, last } = await withPlatformTx(
    async (tx) => {
      const within = { occurredAt: { gte: since }, tenantId: { not: null } };
      const [byTenant, byTenantUser, byTenantFeature, byTenantModel, fallbacks, last] = await Promise.all([
        tx.aiEvent.groupBy({
          by: ['tenantId'],
          where: within,
          _sum: { inputTokens: true, outputTokens: true, costMicros: true },
          _count: { _all: true },
        }),
        tx.aiEvent.groupBy({
          by: ['tenantId', 'userId'],
          where: { ...within, userId: { not: null } },
          _sum: { inputTokens: true, outputTokens: true },
        }),
        tx.aiEvent.groupBy({
          by: ['tenantId', 'feature'],
          where: within,
          _sum: { inputTokens: true, outputTokens: true },
        }),
        tx.aiEvent.groupBy({
          by: ['tenantId', 'provider', 'model'],
          where: within,
          _count: { _all: true },
        }),
        tx.aiEvent.groupBy({ by: ['tenantId'], where: { ...within, outcome: 'FELL_BACK' }, _count: { _all: true } }),
        tx.aiEvent.groupBy({ by: ['tenantId'], where: { tenantId: { not: null } }, _max: { occurredAt: true } }),
      ]);
      return { byTenant, byTenantUser, byTenantFeature, byTenantModel, fallbacks, last };
    },
  );

  const tenantIds = [...new Set(byTenant.map((r) => r.tenantId!).filter(Boolean))];
  // A company with a budget but no activity yet still belongs on the list: that
  // is exactly the one an operator has just configured and wants to confirm.
  const budgeted = await prisma.aiBudget.findMany({
    where: { scope: 'TENANT', enabled: true },
    select: { scopeId: true },
  });
  for (const b of budgeted) if (b.scopeId && !tenantIds.includes(b.scopeId)) tenantIds.push(b.scopeId);
  if (!tenantIds.length) return { rows: [], since: since.toISOString() };

  const [tenants, users, subscriptions, ceilings] = await Promise.all([
    prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, displayName: true, slug: true },
    }),
    withPlatformTx((tx) =>
      tx.user.findMany({
        where: { tenantId: { in: tenantIds }, deletedAt: null },
        select: { id: true, fullName: true, tenantId: true },
      }),
    ),
    withPlatformTx((tx) =>
      tx.tenantSubscription.findMany({
        where: { tenantId: { in: tenantIds } },
        select: { tenantId: true, plan: { select: { name: true } } },
      }),
    ),
    prisma.aiBudget.findMany({
      where: { scope: 'TENANT', scopeId: { in: tenantIds }, feature: null, appliesPerUser: false, enabled: true },
    }),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.fullName ?? u.id]));
  const planOf = new Map(subscriptions.map((s) => [s.tenantId, s.plan?.name ?? null]));
  const ceilingOf = new Map(ceilings.map((c) => [c.scopeId!, c]));

  const rows: WorkspaceRow[] = tenants.map((tenant) => {
    const totals = byTenant.find((r) => r.tenantId === tenant.id);
    const input = nz(totals?._sum.inputTokens);
    const output = nz(totals?._sum.outputTokens);
    const used = input + output;
    const ceiling = ceilingOf.get(tenant.id);
    const limit = ceiling?.tokenLimit === undefined || ceiling?.tokenLimit === null ? null : Number(ceiling.tokenLimit);
    const percent = limit === null ? null : limit > 0 ? Math.round((used / limit) * 1000) / 10 : 100;

    const mine = byTenantUser.filter((r) => r.tenantId === tenant.id);
    const top = [...mine].sort(
      (a, b) => nz(b._sum.inputTokens) + nz(b._sum.outputTokens) - (nz(a._sum.inputTokens) + nz(a._sum.outputTokens)),
    )[0];
    const feature = [...byTenantFeature.filter((r) => r.tenantId === tenant.id)].sort(
      (a, b) => nz(b._sum.inputTokens) + nz(b._sum.outputTokens) - (nz(a._sum.inputTokens) + nz(a._sum.outputTokens)),
    )[0];
    const model = [...byTenantModel.filter((r) => r.tenantId === tenant.id)].sort(
      (a, b) => b._count._all - a._count._all,
    )[0];

    return {
      tenantId: tenant.id,
      name: tenant.displayName,
      slug: tenant.slug,
      planName: planOf.get(tenant.id) ?? null,
      tokenLimit: limit,
      usedTokens: used,
      remaining: limit === null ? null : Math.max(0, limit - used),
      percent,
      inputTokens: input,
      outputTokens: output,
      amount: microsToAmount(totals?._sum.costMicros ?? 0n),
      activeUsers: mine.length,
      topUser: top?.userId
        ? {
            userId: top.userId,
            name: nameOf.get(top.userId) ?? top.userId,
            tokens: nz(top._sum.inputTokens) + nz(top._sum.outputTokens),
          }
        : null,
      topFeature: feature
        ? {
            feature: feature.feature,
            label: featureLabel(feature.feature),
            tokens: nz(feature._sum.inputTokens) + nz(feature._sum.outputTokens),
          }
        : null,
      topModel: model?.model
        ? { provider: model.provider ?? '—', model: model.model, requests: model._count._all }
        : null,
      fallbacks: fallbacks.find((f) => f.tenantId === tenant.id)?._count._all ?? 0,
      status: usageStatus(percent, limit === 0, ceiling?.thresholds ?? [70, 85, 95]),
      lastActivityAt: last.find((l) => l.tenantId === tenant.id)?._max.occurredAt?.toISOString() ?? null,
    };
  });

  rows.sort((a, b) => b.usedTokens - a.usedTokens || a.name.localeCompare(b.name));
  return { rows, since: since.toISOString() };
}

export interface WorkspaceUserRow {
  userId: string;
  name: string;
  roleName: string | null;
  allowance: number | null;
  allowanceSource: string;
  overridden: boolean;
  usedTokens: number;
  remaining: number | null;
  percent: number | null;
  inputTokens: number;
  outputTokens: number;
  amount: number;
  requests: number;
  topFeature: string | null;
  lastActivityAt: string | null;
  status: UsageStatus;
}

export interface WorkspaceDetail {
  tenantId: string;
  name: string;
  slug: string;
  planName: string | null;
  planId: string | null;
  since: string;
  totals: { tokens: number; input: number; output: number; amount: number; requests: number; fallbacks: number };
  ceiling: {
    id: string | null;
    tokenLimit: number | null;
    costLimit: number | null;
    thresholds: number[];
    action: string;
    hardLimit: boolean;
  };
  perUserDefault: { id: string | null; tokenLimit: number | null };
  featureBudgets: { id: string; feature: string; label: string; tokenLimit: number | null; used: number }[];
  users: WorkspaceUserRow[];
  byFeature: { feature: string; label: string; tokens: number; requests: number; amount: number }[];
  byModel: { provider: string; model: string; requests: number; tokens: number }[];
}

export async function loadWorkspace(tenantId: string, now: Date = new Date()): Promise<WorkspaceDetail | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, displayName: true, slug: true },
  });
  if (!tenant) return null;
  const since = periodStart('MONTHLY', now);

  const { totals, byUser, byFeature, byModel, fallbacks, lastByUser, topFeatureByUser } = await withPlatformTx(
    async (tx) => {
      const within = { tenantId, occurredAt: { gte: since } };
      const [totals, byUser, byFeature, byModel, fallbacks, lastByUser, topFeatureByUser] = await Promise.all([
        tx.aiEvent.aggregate({
          where: within,
          _count: { _all: true },
          _sum: { inputTokens: true, outputTokens: true, costMicros: true },
        }),
        tx.aiEvent.groupBy({
          by: ['userId'],
          where: { ...within, userId: { not: null } },
          _count: { _all: true },
          _sum: { inputTokens: true, outputTokens: true, costMicros: true },
        }),
        tx.aiEvent.groupBy({
          by: ['feature'],
          where: within,
          _count: { _all: true },
          _sum: { inputTokens: true, outputTokens: true, costMicros: true },
        }),
        tx.aiEvent.groupBy({
          by: ['provider', 'model'],
          where: within,
          _count: { _all: true },
          _sum: { inputTokens: true, outputTokens: true },
        }),
        tx.aiEvent.count({ where: { ...within, outcome: 'FELL_BACK' } }),
        tx.aiEvent.groupBy({ by: ['userId'], where: { tenantId }, _max: { occurredAt: true } }),
        tx.aiEvent.groupBy({
          by: ['userId', 'feature'],
          where: { ...within, userId: { not: null } },
          _sum: { inputTokens: true, outputTokens: true },
        }),
      ]);
      return { totals, byUser, byFeature, byModel, fallbacks, lastByUser, topFeatureByUser };
    },
  );

  const [subscription, people, ceilingRow, perUserRow, featureRows] = await Promise.all([
    withPlatformTx((tx) =>
      tx.tenantSubscription.findUnique({
        where: { tenantId },
        select: { planId: true, plan: { select: { name: true } } },
      }),
    ),
    withPlatformTx((tx) =>
      tx.user.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, fullName: true, role: { select: { name: true } } },
      }),
    ),
    prisma.aiBudget.findFirst({
      where: { scope: 'TENANT', scopeId: tenantId, feature: null, appliesPerUser: false, enabled: true },
    }),
    prisma.aiBudget.findFirst({
      where: { scope: 'TENANT', scopeId: tenantId, feature: null, appliesPerUser: true, enabled: true },
    }),
    prisma.aiBudget.findMany({
      where: { scope: 'TENANT', scopeId: tenantId, feature: { not: null }, appliesPerUser: false },
    }),
  ]);

  // Only people who used AI or carry an override need a row; a thousand-seat
  // company would otherwise render a thousand empty rows.
  const active = new Set(byUser.map((u) => u.userId!).filter(Boolean));
  const overrides = await prisma.aiBudget.findMany({
    where: { scope: 'USER', enabled: true, scopeId: { in: people.map((p) => p.id) } },
    select: { scopeId: true },
  });
  for (const o of overrides) if (o.scopeId) active.add(o.scopeId);

  const users: WorkspaceUserRow[] = [];
  for (const person of people.filter((p) => active.has(p.id))) {
    const row = byUser.find((u) => u.userId === person.id);
    const state = await allowanceState(tenantId, person.id, null, now);
    const mineByFeature = topFeatureByUser
      .filter((f) => f.userId === person.id)
      .sort(
        (a, b) => nz(b._sum.inputTokens) + nz(b._sum.outputTokens) - (nz(a._sum.inputTokens) + nz(a._sum.outputTokens)),
      );
    users.push({
      userId: person.id,
      name: person.fullName ?? person.id,
      roleName: person.role?.name ?? null,
      allowance: state.tokenLimit,
      allowanceSource: state.source,
      overridden: state.overridden,
      usedTokens: state.usedTokens,
      remaining: state.remaining,
      percent: state.percent,
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
      amount: microsToAmount(state.usedMicros),
      requests: row?._count._all ?? 0,
      topFeature: mineByFeature[0] ? featureLabel(mineByFeature[0].feature) : null,
      lastActivityAt: lastByUser.find((l) => l.userId === person.id)?._max.occurredAt?.toISOString() ?? null,
      status: state.status,
    });
  }
  users.sort((a, b) => b.usedTokens - a.usedTokens || a.name.localeCompare(b.name));

  return {
    tenantId,
    name: tenant.displayName,
    slug: tenant.slug,
    planName: subscription?.plan?.name ?? null,
    planId: subscription?.planId ?? null,
    since: since.toISOString(),
    totals: {
      tokens: nz(totals._sum.inputTokens) + nz(totals._sum.outputTokens),
      input: nz(totals._sum.inputTokens),
      output: nz(totals._sum.outputTokens),
      amount: microsToAmount(totals._sum.costMicros ?? 0n),
      requests: totals._count._all,
      fallbacks,
    },
    ceiling: {
      id: ceilingRow?.id ?? null,
      tokenLimit:
        ceilingRow?.tokenLimit === undefined || ceilingRow?.tokenLimit === null ? null : Number(ceilingRow.tokenLimit),
      costLimit:
        ceilingRow?.costLimit === undefined || ceilingRow?.costLimit === null ? null : Number(ceilingRow.costLimit),
      thresholds: ceilingRow?.thresholds ?? [70, 85, 95],
      action: ceilingRow?.action ?? 'ALERT_ONLY',
      hardLimit: ceilingRow?.hardLimit ?? false,
    },
    perUserDefault: {
      id: perUserRow?.id ?? null,
      tokenLimit:
        perUserRow?.tokenLimit === undefined || perUserRow?.tokenLimit === null ? null : Number(perUserRow.tokenLimit),
    },
    featureBudgets: featureRows.map((f) => ({
      id: f.id,
      feature: f.feature!,
      label: featureLabel(f.feature!),
      tokenLimit: f.tokenLimit === null ? null : Number(f.tokenLimit),
      used:
        nz(byFeature.find((b) => b.feature === f.feature)?._sum.inputTokens) +
        nz(byFeature.find((b) => b.feature === f.feature)?._sum.outputTokens),
    })),
    users,
    byFeature: byFeature
      .map((f) => ({
        feature: f.feature,
        label: featureLabel(f.feature),
        tokens: nz(f._sum.inputTokens) + nz(f._sum.outputTokens),
        requests: f._count._all,
        amount: microsToAmount(f._sum.costMicros ?? 0n),
      }))
      .sort((a, b) => b.tokens - a.tokens),
    byModel: byModel
      .map((m) => ({
        provider: m.provider ?? '—',
        model: m.model ?? '—',
        requests: m._count._all,
        tokens: nz(m._sum.inputTokens) + nz(m._sum.outputTokens),
      }))
      .sort((a, b) => b.requests - a.requests),
  };
}

export interface UserDetail {
  tenantId: string;
  workspaceName: string;
  userId: string;
  name: string;
  email: string | null;
  roleName: string | null;
  planName: string | null;
  state: AllowanceState;
  amount: number;
  byFeature: { feature: string; label: string; tokens: number; requests: number; amount: number }[];
  byModel: { provider: string; model: string; requests: number; tokens: number; fallbacks: number }[];
  months: { month: string; tokens: number; requests: number; amount: number }[];
  recent: {
    id: string;
    occurredAt: string;
    feature: string;
    model: string | null;
    outcome: string;
    reason: string | null;
    tokens: number;
  }[];
  fallbacks: number;
  /** Every level that named a number, for the inherited/override/effective column. */
  chain: AllowanceState['chain'];
}

export async function loadUser(tenantId: string, userId: string, now: Date = new Date()): Promise<UserDetail | null> {
  const [tenant, person] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { displayName: true } }),
    withPlatformTx((tx) =>
      tx.user.findFirst({
        where: { id: userId, tenantId },
        select: { id: true, fullName: true, email: true, role: { select: { name: true } } },
      }),
    ),
  ]);
  if (!tenant || !person) return null;

  const state = await allowanceState(tenantId, userId, null, now);
  const since = periodStart(state.period, now);
  const twelveMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

  const { byFeature, byModel, fallbacksByModel, history, recent, fallbacks, subscription } = await withPlatformTx(
    async (tx) => {
      const mine = { tenantId, userId };
      const [byFeature, byModel, fallbacksByModel, history, recent, fallbacks, subscription] = await Promise.all([
        tx.aiEvent.groupBy({
          by: ['feature'],
          where: { ...mine, occurredAt: { gte: since } },
          _count: { _all: true },
          _sum: { inputTokens: true, outputTokens: true, costMicros: true },
        }),
        tx.aiEvent.groupBy({
          by: ['provider', 'model'],
          where: { ...mine, occurredAt: { gte: since } },
          _count: { _all: true },
          _sum: { inputTokens: true, outputTokens: true },
        }),
        tx.aiEvent.groupBy({
          by: ['provider', 'model'],
          where: { ...mine, occurredAt: { gte: since }, outcome: 'FELL_BACK' },
          _count: { _all: true },
        }),
        tx.aiEvent.findMany({
          where: { ...mine, occurredAt: { gte: twelveMonthsAgo } },
          select: { occurredAt: true, inputTokens: true, outputTokens: true, costMicros: true },
        }),
        tx.aiEvent.findMany({
          where: mine,
          orderBy: { occurredAt: 'desc' },
          take: 25,
          select: {
            id: true,
            occurredAt: true,
            feature: true,
            model: true,
            outcome: true,
            reason: true,
            inputTokens: true,
            outputTokens: true,
          },
        }),
        tx.aiEvent.count({ where: { ...mine, occurredAt: { gte: since }, outcome: 'FELL_BACK' } }),
        tx.tenantSubscription.findUnique({ where: { tenantId }, select: { plan: { select: { name: true } } } }),
      ]);
      return { byFeature, byModel, fallbacksByModel, history, recent, fallbacks, subscription };
    },
  );

  // Rolled up here rather than in SQL: twelve months of one person's rows is a
  // small set, and a date_trunc would be raw SQL outside a tenant transaction.
  const months = new Map<string, { tokens: number; requests: number; micros: bigint }>();
  for (const row of history) {
    const key = row.occurredAt.toISOString().slice(0, 7);
    const bucket = months.get(key) ?? { tokens: 0, requests: 0, micros: 0n };
    bucket.tokens += row.inputTokens + row.outputTokens;
    bucket.requests += 1;
    bucket.micros += row.costMicros;
    months.set(key, bucket);
  }

  return {
    tenantId,
    workspaceName: tenant.displayName,
    userId,
    name: person.fullName ?? userId,
    email: person.email ?? null,
    roleName: person.role?.name ?? null,
    planName: subscription?.plan?.name ?? null,
    state,
    amount: microsToAmount(state.usedMicros),
    byFeature: byFeature
      .map((f) => ({
        feature: f.feature,
        label: featureLabel(f.feature),
        tokens: nz(f._sum.inputTokens) + nz(f._sum.outputTokens),
        requests: f._count._all,
        amount: microsToAmount(f._sum.costMicros ?? 0n),
      }))
      .sort((a, b) => b.tokens - a.tokens),
    byModel: byModel
      .map((m) => ({
        provider: m.provider ?? '—',
        model: m.model ?? '—',
        requests: m._count._all,
        tokens: nz(m._sum.inputTokens) + nz(m._sum.outputTokens),
        fallbacks: fallbacksByModel.find((f) => f.provider === m.provider && f.model === m.model)?._count._all ?? 0,
      }))
      .sort((a, b) => b.requests - a.requests),
    months: [...months.entries()]
      .map(([month, v]) => ({ month, tokens: v.tokens, requests: v.requests, amount: microsToAmount(v.micros) }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    recent: recent.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt.toISOString(),
      feature: featureLabel(r.feature),
      model: r.model,
      outcome: r.outcome,
      reason: r.reason,
      tokens: r.inputTokens + r.outputTokens,
    })),
    fallbacks,
    chain: state.chain,
  };
}

export const AI_FEATURE_OPTIONS = AI_FEATURES.map((f) => ({ key: f.key, label: f.label }));
