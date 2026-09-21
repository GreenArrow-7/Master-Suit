import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { allowanceFor, allowanceState, enforceBudgets, usageStatus } from '@/lib/ai/allowance';
import { periodStart } from '@/lib/ai/budgets';
import { loadWorkspace, loadUser, loadWorkspaces } from '@/services/ai/console';

/**
 * Who may spend what, and what the console says about it.
 *
 * The thing worth testing here is not any single number but the order they come
 * in: a person's allowance is inherited down the chain and replaced by an
 * override, while the ceilings above them are enforced whatever any override
 * says. Getting that backwards either refuses paid-for work or hands a company
 * an unbounded bill, and both look correct on a screen.
 */
const suffix = randomBytes(4).toString('hex');
const feature = 'call-audit';
let tenantId = '';
let otherTenantId = '';
let alice = '';
let bob = '';
let planId = '';

async function makeTenant(tag: string) {
  const tenant = await prisma.tenant.create({
    data: {
      slug: `alw-${tag}-${suffix}`,
      legalName: `Allowance ${tag}`,
      displayName: `Allowance ${tag}`,
      status: 'ACTIVE',
    },
  });
  const role = await prisma.role.create({
    data: { tenantId: tenant.id, key: `rep-${tag}-${suffix}`, name: 'Rep', rank: 60, defaultScope: 'OWN' },
  });
  return { tenant, role };
}

beforeAll(async () => {
  const a = await makeTenant('a');
  tenantId = a.tenant.id;
  const b = await makeTenant('b');
  otherTenantId = b.tenant.id;

  const mk = async (name: string, roleId: string, tid: string) =>
    (
      await prisma.user.create({
        data: { tenantId: tid, email: `${name}-${suffix}@example.com`, fullName: name, roleId, status: 'ACTIVE' },
      })
    ).id;
  alice = await mk('Alice', a.role.id, tenantId);
  bob = await mk('Bob', a.role.id, tenantId);

  const plan = await prisma.subscriptionPlan.create({
    data: { code: `plan-${suffix}`, name: `Plan ${suffix}`, seatLimit: 50, storageMb: 1024 },
  });
  planId = plan.id;
  await prisma.tenantSubscription.create({ data: { tenantId, planId, state: 'ACTIVE' } });
});

afterAll(async () => {
  await prisma.aiBudget.deleteMany({
    where: { OR: [{ scopeId: { in: [tenantId, otherTenantId, alice, bob, planId] } }, { scope: 'PLATFORM' }] },
  });
  await prisma.aiEvent.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  for (const id of [tenantId, otherTenantId]) await prisma.tenant.delete({ where: { id } }).catch(() => {});
  await prisma.subscriptionPlan.delete({ where: { id: planId } }).catch(() => {});
});

const spend = (userId: string, tokens: number, tid = tenantId, feat = feature) =>
  prisma.aiEvent.create({
    data: {
      tenantId: tid,
      userId,
      feature: feat,
      provider: 'google',
      model: 'test-model',
      inputTokens: Math.floor(tokens / 2),
      outputTokens: Math.ceil(tokens / 2),
      occurredAt: new Date(periodStart('MONTHLY').getTime() + 1000),
    },
  });

describe('the allowance inheritance chain', () => {
  it('falls back through workspace and plan, and an override replaces both', async () => {
    await prisma.aiBudget.create({
      data: { scope: 'PLATFORM', scopeId: null, appliesPerUser: true, tokenLimit: BigInt(100_000) },
    });
    expect((await allowanceFor(tenantId, alice)).tokenLimit, 'the platform default').toBe(100_000);
    expect((await allowanceFor(tenantId, alice)).source).toBe('platform');

    await prisma.aiBudget.create({
      data: { scope: 'PLAN', scopeId: planId, appliesPerUser: true, tokenLimit: BigInt(300_000) },
    });
    expect((await allowanceFor(tenantId, alice)).tokenLimit, 'the plan beats the platform').toBe(300_000);

    await prisma.aiBudget.create({
      data: { scope: 'TENANT', scopeId: tenantId, appliesPerUser: true, tokenLimit: BigInt(500_000) },
    });
    const workspace = await allowanceFor(tenantId, alice);
    expect(workspace.tokenLimit, 'the workspace beats the plan').toBe(500_000);
    expect(workspace.source).toBe('workspace');
    expect(workspace.overridden).toBe(false);

    const override = await prisma.aiBudget.create({
      data: { scope: 'USER', scopeId: alice, tokenLimit: BigInt(750_000) },
    });
    const withOverride = await allowanceFor(tenantId, alice);
    expect(withOverride.tokenLimit, "the person's own number wins outright").toBe(750_000);
    expect(withOverride.source).toBe('user');
    expect(withOverride.overridden).toBe(true);
    // Every level that named a number is still listed, so the console can show
    // what the override replaced and what removing it returns to.
    expect(withOverride.chain.map((c) => c.tokenLimit)).toEqual([750_000, 500_000, 300_000, 100_000]);

    // Bob, with no override, still inherits the workspace default.
    expect((await allowanceFor(tenantId, bob)).tokenLimit).toBe(500_000);

    // Removing the override falls back automatically; nothing has to be rewritten.
    await prisma.aiBudget.delete({ where: { id: override.id } });
    expect((await allowanceFor(tenantId, alice)).tokenLimit).toBe(500_000);
    expect((await allowanceFor(tenantId, alice)).overridden).toBe(false);
  });

  it('a per-person default is not a company ceiling, and a company ceiling is not a per-person default', async () => {
    await prisma.aiBudget.create({
      data: { scope: 'TENANT', scopeId: tenantId, appliesPerUser: false, tokenLimit: BigInt(10_000_000) },
    });
    // Both rows exist for the same workspace and the same period. The per-person
    // one is what a person inherits; the other is the ceiling over everybody.
    expect((await allowanceFor(tenantId, alice)).tokenLimit).toBe(500_000);
    const ceiling = await prisma.aiBudget.findFirst({
      where: { scope: 'TENANT', scopeId: tenantId, appliesPerUser: false },
    });
    expect(Number(ceiling!.tokenLimit)).toBe(10_000_000);
  });
});

describe('enforcement', () => {
  it('refuses the person who is out, and not the colleague who is not', async () => {
    await prisma.aiBudget.deleteMany({ where: { scope: 'USER', scopeId: { in: [alice, bob] } } });
    await prisma.aiBudget.create({
      data: { scope: 'USER', scopeId: alice, tokenLimit: BigInt(1000), action: 'BLOCK' },
    });
    await spend(alice, 1500);

    const refused = await enforceBudgets({ tenantId, userId: alice, feature, provider: 'google' });
    expect(refused.allowed).toBe(false);
    expect(refused.level).toBe('user');
    expect(refused.message).toMatch(/allowance/i);

    const allowed = await enforceBudgets({ tenantId, userId: bob, feature, provider: 'google' });
    expect(allowed.allowed, 'Bob has spent nothing').toBe(true);
  });

  it('a generous override does not lift the company ceiling', async () => {
    await prisma.aiBudget.deleteMany({ where: { scope: 'USER', scopeId: alice } });
    await prisma.aiBudget.updateMany({
      where: { scope: 'TENANT', scopeId: tenantId, appliesPerUser: false },
      data: { tokenLimit: BigInt(1000), action: 'BLOCK' },
    });
    await prisma.aiBudget.create({
      data: { scope: 'USER', scopeId: alice, tokenLimit: BigInt(9_000_000), action: 'ALERT_ONLY' },
    });

    const verdict = await enforceBudgets({ tenantId, userId: alice, feature, provider: 'google' });
    expect(verdict.allowed, 'the company is out, whatever Alice was given').toBe(false);
    expect(verdict.level).toBe('workspace');

    await prisma.aiBudget.updateMany({
      where: { scope: 'TENANT', scopeId: tenantId, appliesPerUser: false },
      data: { tokenLimit: BigInt(10_000_000), action: 'ALERT_ONLY' },
    });
  });

  it('an alert-only allowance warns and lets the work through; a cheaper-model one asks to degrade', async () => {
    await prisma.aiBudget.deleteMany({ where: { scope: 'USER', scopeId: alice } });
    await prisma.aiBudget.create({
      data: { scope: 'USER', scopeId: alice, tokenLimit: BigInt(10), action: 'ALERT_ONLY' },
    });
    const alerting = await enforceBudgets({ tenantId, userId: alice, feature, provider: 'google' });
    expect(alerting.allowed).toBe(true);

    await prisma.aiBudget.updateMany({ where: { scope: 'USER', scopeId: alice }, data: { action: 'CHEAPER_MODEL' } });
    const degraded = await enforceBudgets({ tenantId, userId: alice, feature, provider: 'google' });
    expect(degraded.allowed).toBe(true);
    expect(degraded.downgrade, 'the caller is asked to drop a step, not to refuse').toBe(true);
  });

  it('a zero allowance switches AI off for that account and says so', async () => {
    await prisma.aiBudget.deleteMany({ where: { scope: 'USER', scopeId: bob } });
    await prisma.aiBudget.create({ data: { scope: 'USER', scopeId: bob, tokenLimit: BigInt(0), action: 'BLOCK' } });
    const state = await allowanceState(tenantId, bob);
    expect(state.disabled).toBe(true);
    expect(state.status).toBe('disabled');

    const verdict = await enforceBudgets({ tenantId, userId: bob, feature, provider: 'google' });
    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toMatch(/switched off/i);

    // Removing the row re-enables it, with no second concept to reset.
    await prisma.aiBudget.deleteMany({ where: { scope: 'USER', scopeId: bob } });
    expect((await allowanceState(tenantId, bob)).disabled).toBe(false);
    expect((await enforceBudgets({ tenantId, userId: bob, feature, provider: 'google' })).allowed).toBe(true);
  });

  it('a background job with no person behind it is charged to the workspace, not to anybody', async () => {
    await prisma.aiBudget.deleteMany({ where: { scope: 'USER', scopeId: { in: [alice, bob] } } });
    const verdict = await enforceBudgets({ tenantId, userId: null, feature, provider: 'google' });
    expect(verdict.allowed, 'no person means no personal allowance to exceed').toBe(true);

    await prisma.aiEvent.create({
      data: { tenantId, userId: null, feature, inputTokens: 10, outputTokens: 10, provider: 'google', model: 'm' },
    });
    const detail = await loadWorkspace(tenantId);
    expect(detail!.totals.tokens, "the workspace's own total counts it").toBeGreaterThan(0);
    expect(detail!.users.some((u) => u.userId === (null as unknown as string))).toBe(false);
  });
});

describe('the status word', () => {
  it('names each band, and never calls an unlimited account critical', () => {
    expect(usageStatus(10, false)).toBe('normal');
    expect(usageStatus(70, false)).toBe('warning');
    expect(usageStatus(86, false)).toBe('warning');
    expect(usageStatus(95, false)).toBe('critical');
    expect(usageStatus(100, false)).toBe('limit-reached');
    expect(usageStatus(140, false)).toBe('limit-reached');
    expect(usageStatus(null, false)).toBe('no-limit');
    expect(usageStatus(20, true), 'disabled outranks the percentage').toBe('disabled');
  });
});

describe('the console', () => {
  it('shows one company its own people and never another company’s', async () => {
    await spend(alice, 400);
    const otherRole = await prisma.role.findFirst({ where: { tenantId: otherTenantId } });
    const stranger = await prisma.user.create({
      data: {
        tenantId: otherTenantId,
        email: `stranger-${suffix}@example.com`,
        fullName: 'Stranger',
        roleId: otherRole!.id,
        status: 'ACTIVE',
      },
    });
    await spend(stranger.id, 900, otherTenantId);

    const detail = await loadWorkspace(tenantId);
    expect(detail!.users.map((u) => u.name)).not.toContain('Stranger');
    expect(detail!.users.map((u) => u.name)).toContain('Alice');

    const other = await loadWorkspace(otherTenantId);
    expect(other!.users.map((u) => u.name)).toEqual(['Stranger']);

    // And a person from one company cannot be opened under the other.
    expect(await loadUser(otherTenantId, alice)).toBeNull();
    expect((await loadUser(tenantId, alice))?.name).toBe('Alice');
  });

  it('breaks one person down by feature, so a heavy account can be explained', async () => {
    await spend(alice, 200, tenantId, 'live-coach');
    await spend(alice, 100, tenantId, 'assistant');
    const detail = await loadUser(tenantId, alice);
    const features = detail!.byFeature.map((f) => f.feature);
    expect(features).toContain('live-coach');
    expect(features).toContain('assistant');
    expect(detail!.byFeature.reduce((sum, f) => sum + f.tokens, 0)).toBe(detail!.state.usedTokens);
    expect(detail!.months.length, 'this month at least').toBeGreaterThanOrEqual(1);
  });

  it('lists a workspace that has a budget but has not used AI yet', async () => {
    const { rows } = await loadWorkspaces();
    expect(rows.some((r) => r.tenantId === tenantId)).toBe(true);
    const row = rows.find((r) => r.tenantId === tenantId)!;
    expect(row.activeUsers).toBeGreaterThanOrEqual(1);
    expect(row.topUser?.name).toBeTruthy();
  });
});
