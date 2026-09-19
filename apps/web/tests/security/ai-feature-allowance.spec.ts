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
