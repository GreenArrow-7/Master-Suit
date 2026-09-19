import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { assertAiBudget, featureLimitKey, featureUsageMetric, recordAiUsage, usageMetric } from '@/lib/ai/usage';

/**
 * §18: a plan can cap one AI feature's monthly tokens on the shared key without
 * capping the rest; usage is recorded per feature so the cap has something to read.
 */
const suffix = randomBytes(4).toString('hex');
let tenantId = '';
const deployment = { key: 'k', source: 'deployment', provider: 'google' } as const;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `aifeat-${suffix}`, legalName: 'AI Feature LLC', displayName: 'AI Feature', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  const plan = await prisma.subscriptionPlan.create({
    data: {
      code: `aifeat-${suffix}`,
      name: 'AI feature plan',
      seatLimit: 10,
      storageMb: 1024,
      planLimits: { create: [{ key: featureLimitKey('live-coach'), value: 1000 }] },
    },
  });
  await prisma.tenantSubscription.create({ data: { tenantId, planId: plan.id, state: 'ACTIVE' } });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('per-feature AI allowance', () => {
  it('records usage by feature alongside the workspace total', async () => {
    await recordAiUsage(tenantId, deployment, { totalTokens: 600 }, { feature: 'live-coach', model: 'm' });
    await recordAiUsage(tenantId, deployment, { totalTokens: 300 }, { feature: 'call-analysis', model: 'm' });
    const rows = await prisma.workspaceUsage.findMany({ where: { tenantId }, select: { metric: true, used: true } });
    const by = Object.fromEntries(rows.map((r) => [r.metric, r.used]));
    expect(by[usageMetric('deployment')]).toBe(900);
    expect(by[featureUsageMetric('deployment', 'live-coach')]).toBe(600);
    expect(by[featureUsageMetric('deployment', 'call-analysis')]).toBe(300);
  });

  it('refuses only the capped feature once it reaches its ceiling', async () => {
    await expect(assertAiBudget(tenantId, deployment, 'live-coach')).resolves.toBeUndefined();
    await recordAiUsage(tenantId, deployment, { totalTokens: 400 }, { feature: 'live-coach', model: 'm' });
    await expect(assertAiBudget(tenantId, deployment, 'live-coach')).rejects.toMatchObject({ status: 403 });
    await expect(assertAiBudget(tenantId, deployment, 'call-analysis')).resolves.toBeUndefined();
    // A workspace key is never capped by the plan.
    await expect(
      assertAiBudget(tenantId, { key: 'own', source: 'workspace', provider: 'google' }, 'live-coach'),
    ).resolves.toBeUndefined();
  });
});

describe('per-user AI allowance', () => {
  it('caps one person on the shared key without touching another', async () => {
    const { USER_TOKEN_LIMIT_KEY, userUsageMetric } = await import('@/lib/ai/usage');
    const sub = await prisma.tenantSubscription.findUniqueOrThrow({ where: { tenantId }, select: { planId: true } });
    await prisma.planLimit.create({ data: { planId: sub.planId, key: USER_TOKEN_LIMIT_KEY, value: 500 } });

    await recordAiUsage(
      tenantId,
      deployment,
      { totalTokens: 500 },
      { feature: 'assistant', model: 'm', userId: 'user-a' },
    );
    const row = await prisma.workspaceUsage.findUnique({
      where: { tenantId_metric: { tenantId, metric: userUsageMetric('deployment', 'user-a') } },
    });
    expect(row?.used).toBe(500);

    await expect(assertAiBudget(tenantId, deployment, 'assistant', 'user-a')).rejects.toMatchObject({ status: 403 });
    await expect(assertAiBudget(tenantId, deployment, 'assistant', 'user-b')).resolves.toBeUndefined();
    // No person behind the request (a worker job): the per-user ceiling does not apply.
    await expect(assertAiBudget(tenantId, deployment, 'assistant')).resolves.toBeUndefined();
  });
});

describe('token direction and cost estimate', () => {
  it('records input and output tokens separately and prices them only when rates are stated', async () => {
    const { inputUsageMetric, outputUsageMetric, estimateCostUsd } = await import('@/lib/ai/usage');
    await recordAiUsage(
      tenantId,
      deployment,
      { promptTokens: 700, completionTokens: 300, totalTokens: 1000 },
      { feature: 'call-audit', model: 'm' },
    );
    const rows = await prisma.workspaceUsage.findMany({
      where: { tenantId, metric: { in: [inputUsageMetric('deployment'), outputUsageMetric('deployment')] } },
      select: { metric: true, used: true },
    });
    const by = Object.fromEntries(rows.map((r) => [r.metric, r.used]));
    expect(by[inputUsageMetric('deployment')]).toBe(700);
    expect(by[outputUsageMetric('deployment')]).toBe(300);

    delete process.env.AI_COST_USD_PER_MILLION_INPUT;
    delete process.env.AI_COST_USD_PER_MILLION_OUTPUT;
    expect(estimateCostUsd(700, 300)).toBeNull();
    process.env.AI_COST_USD_PER_MILLION_INPUT = '0.30';
    process.env.AI_COST_USD_PER_MILLION_OUTPUT = '2.50';
    expect(estimateCostUsd(1_000_000, 1_000_000)).toBe(2.8);
  });
});
