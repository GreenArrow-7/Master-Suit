/**
 * P1-2 — AI spend was unmetered and uncapped.
 *
 * Nothing counted tokens: not per workspace, not in aggregate, not at all. A
 * single tenant transcribing a backlog could exhaust the deployment's Gemini
 * budget for every other tenant, and afterwards there was no record of which one
 * had. The `ai` worker's concurrency of 2 limits the rate, not the bill.
 *
 * The design decision worth pinning is *meter both, cap one*: a workspace on its
 * own key spends its own quota against its own Google bill, so capping it would
 * charge it for a limit it is already paying past. The ceiling applies to the
 * shared deployment key, which is the budget somebody else can exhaust.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { AI_TOKEN_LIMIT_KEY, assertAiBudget, recordAiUsage, usageMetric } from '@/lib/ai/usage';
import type { GeminiCredential } from '@/lib/ai/gemini';

const suffix = randomBytes(4).toString('hex');

const DEPLOYMENT: GeminiCredential = { key: 'deployment-key', source: 'deployment', provider: 'google' };
const WORKSPACE: GeminiCredential = { key: 'workspace-key', source: 'workspace', provider: 'google' };
const SIMULATED: GeminiCredential = { key: null, source: 'simulated', provider: 'google' };

let cappedTenant = '';
let uncappedTenant = '';
let planId = '';
let unlimitedPlanId = '';

const used = (tenantId: string) =>
  prisma.workspaceUsage
    .findUnique({ where: { tenantId_metric: { tenantId, metric: usageMetric() } }, select: { used: true } })
    .then((r) => r?.used ?? 0);

beforeAll(async () => {
  const capped = await prisma.subscriptionPlan.create({
    data: {
      code: `capped-${suffix}`,
      name: 'Capped',
      seatLimit: 10,
      storageMb: 1024,
      planLimits: { create: [{ key: AI_TOKEN_LIMIT_KEY, value: 1000 }] },
    },
  });
  planId = capped.id;
  const unlimited = await prisma.subscriptionPlan.create({
    data: { code: `unlimited-${suffix}`, name: 'Unlimited', seatLimit: 10, storageMb: 1024 },
  });
  unlimitedPlanId = unlimited.id;

  for (const [label, plan] of [
    ['capped', planId],
    ['uncapped', unlimitedPlanId],
  ] as const) {
    const tenant = await prisma.tenant.create({
      data: {
        slug: `aiusage-${label}-${suffix}`,
        legalName: `${label} LLC`,
        displayName: label,
        status: 'ACTIVE',
      },
    });
    // Separately, and with an explicit tenantId. TenantSubscription is
    // RLS-forced, and a nested create under `Tenant.create` sets no
    // `app.tenant_id` — the tenant does not exist yet when the guard looks for
    // one — so the insert fails its WITH CHECK. Naming the tenant is what pins
    // the setting.
    await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, planId: plan, state: 'ACTIVE' } });
    if (label === 'capped') cappedTenant = tenant.id;
    else uncappedTenant = tenant.id;
  }
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [cappedTenant, uncappedTenant] } } });
  await prisma.subscriptionPlan.deleteMany({ where: { id: { in: [planId, unlimitedPlanId] } } });
});

describe('metering', () => {
  it('attributes a call to the workspace that made it', async () => {
    await recordAiUsage(cappedTenant, DEPLOYMENT, { totalTokens: 120 }, { feature: 'test', model: 'm' });
    expect(await used(cappedTenant)).toBe(120);
    // And to that workspace only.
    expect(await used(uncappedTenant)).toBe(0);
  });

  it('accumulates across calls rather than overwriting', async () => {
    await recordAiUsage(cappedTenant, DEPLOYMENT, { totalTokens: 80 }, { feature: 'test', model: 'm' });
    expect(await used(cappedTenant)).toBe(200);
  });

  it('meters a workspace on its own key too — attribution is not the same as billing', async () => {
    await recordAiUsage(uncappedTenant, WORKSPACE, { totalTokens: 50 }, { feature: 'test', model: 'm' });
    expect(await used(uncappedTenant)).toBe(50);
  });

  it('falls back to prompt + completion when no total is reported', async () => {
    await recordAiUsage(
      uncappedTenant,
      WORKSPACE,
      { promptTokens: 10, completionTokens: 5 },
      { feature: 'test', model: 'm' },
    );
    expect(await used(uncappedTenant)).toBe(65);
  });

  it('records nothing for a simulated answer, which costs nothing', async () => {
    const before = await used(cappedTenant);
    await recordAiUsage(cappedTenant, SIMULATED, { totalTokens: 999 }, { feature: 'test', model: 'sim' });
    expect(await used(cappedTenant)).toBe(before);
  });

  it('never throws, whatever it is handed', async () => {
    // Bookkeeping runs after the model has answered and the caller already has
    // their result. Failing the feature because a counter did not increment
    // trades a working answer for an accurate ledger.
    await expect(
      recordAiUsage('no-such-tenant', DEPLOYMENT, { totalTokens: 5 }, { feature: 'test', model: 'm' }),
    ).resolves.toBeUndefined();
    await expect(recordAiUsage(null, DEPLOYMENT, undefined, { feature: 'test', model: 'm' })).resolves.toBeUndefined();
    await expect(
      recordAiUsage(cappedTenant, DEPLOYMENT, { totalTokens: 0 }, { feature: 'test', model: 'm' }),
    ).resolves.toBeUndefined();
  });
});

describe('the ceiling', () => {
  it('lets a workspace under its allowance through', async () => {
    // 200 used against a limit of 1000.
    await expect(assertAiBudget(cappedTenant, DEPLOYMENT)).resolves.toBeUndefined();
  });

  it('refuses once the allowance is spent', async () => {
    await recordAiUsage(cappedTenant, DEPLOYMENT, { totalTokens: 900 }, { feature: 'test', model: 'm' });
    expect(await used(cappedTenant)).toBeGreaterThanOrEqual(1000);
    await expect(assertAiBudget(cappedTenant, DEPLOYMENT)).rejects.toThrow(/monthly AI allowance/i);
  });

  it('still lets that workspace use its own key', async () => {
    // The whole point of the split: over the *platform's* budget, not over
    // theirs. Connecting a key is the documented way out, and the refusal above
    // says so.
    await expect(assertAiBudget(cappedTenant, WORKSPACE)).resolves.toBeUndefined();
  });

  it('does not cap a plan with no allowance configured', async () => {
    await recordAiUsage(uncappedTenant, DEPLOYMENT, { totalTokens: 10_000_000 }, { feature: 'test', model: 'm' });
    // A platform that has not decided on a number must not refuse work because
    // of a default somebody guessed.
    await expect(assertAiBudget(uncappedTenant, DEPLOYMENT)).resolves.toBeUndefined();
  });

  it('never caps simulation', async () => {
    await expect(assertAiBudget(cappedTenant, SIMULATED)).resolves.toBeUndefined();
  });
});

describe('the period key', () => {
  it('is the UTC month, so a workspace’s month does not depend on its timezone', () => {
    expect(usageMetric(new Date('2026-08-20T23:30:00Z'))).toBe('ai_tokens:2026-08');
    expect(usageMetric(new Date('2026-01-01T00:00:00Z'))).toBe('ai_tokens:2026-01');
  });

  it('rolls over, so last month’s spend does not hold this month hostage', async () => {
    const lastMonth = usageMetric(new Date('2026-07-15T00:00:00Z'));
    expect(lastMonth).not.toBe(usageMetric(new Date('2026-08-15T00:00:00Z')));
  });
});
