import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTx } from '@/lib/db';
import type { PermissionMap } from '@/lib/security/rbac';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { buildActor, buildCtx } from '../helpers/ctx';
import { checkOutQuota, quotaPolicy, workedMinutesSince } from '@/services/hr/checkOutQuota';
import { recordTargetProgress } from '@/services/targets/progress';

/**
 * The check-out gate, against the real database.
 *
 * The unit tests prove the rules. What only a database can show is that the
 * gate reads the *same* target and the *same* progress row the targets screen
 * does — which is the whole reason there is no separate quota table — and that
 * one workspace's rule never reaches another's floor.
 */

let fixture: Fixture;

function ctxFor(tenant: { tenantId: string; userId: string }) {
  return buildCtx(
    buildActor({
      id: tenant.userId,
      tenantId: tenant.tenantId,
      permissions: new Map([['leads:ASSIGN', 'ORGANIZATION']]) as PermissionMap,
    }),
  );
}

async function setRule(
  tenantId: string,
  on: boolean,
  metrics: string[] = ['CALLS_ATTEMPTED'],
  maxHours = 10,
) {
  await prisma.organizationSetting.upsert({
    where: { tenantId },
    update: {
      requireTargetsBeforeCheckOut: on,
      checkOutQuotaMetrics: metrics,
      checkOutQuotaMaxHours: maxHours,
    },
    create: {
      tenantId,
      requireTargetsBeforeCheckOut: on,
      checkOutQuotaMetrics: metrics,
      checkOutQuotaMaxHours: maxHours,
    },
  });
}

/** A daily target covering right now, the way the targets screen creates one. */
async function dailyTarget(tenantId: string, userId: string, metric: string, targetValue: number) {
  const now = new Date();
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);

  return withTx(tenantId, (tx) =>
    tx.employeeTarget.create({
      data: {
        tenantId,
        userId,
        metric: metric as 'CALLS_ATTEMPTED',
        period: 'DAILY',
        targetValue,
        periodStart: start,
        periodEnd: end,
      },
      select: { id: true },
    }),
  );
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('the check-out quota', () => {
  it('is off until a workspace turns it on', async () => {
    const ctx = ctxFor(fixture.a);
    await setRule(ctx.tenantId, false);
    await dailyTarget(ctx.tenantId, ctx.actor.id, 'CALLS_ATTEMPTED', 100);

    expect(await quotaPolicy(ctx.tenantId)).toMatchObject({ requireTargetsBeforeCheckOut: false });
    expect(await checkOutQuota(ctx, 120)).toMatchObject({ blocked: false, rows: [] });
  });

  it('blocks on the target the targets screen shows, counted by the same writer', async () => {
    const ctx = ctxFor(fixture.a);
    await setRule(ctx.tenantId, true);

    const blocked = await checkOutQuota(ctx, 120);
    expect(blocked.blocked).toBe(true);
    expect(blocked.rows[0]).toMatchObject({ metric: 'CALLS_ATTEMPTED', target: 100, achieved: 0, remaining: 100 });

    // The same function the call log calls when a call is logged. No second
    // counter, so the gate and the progress bar cannot disagree.
    for (let i = 0; i < 100; i += 1) await recordTargetProgress(ctx, ctx.actor.id, 'CALLS_ATTEMPTED');

    const released = await checkOutQuota(ctx, 120);
    expect(released.blocked).toBe(false);
    expect(released.rows[0]).toMatchObject({ achieved: 100, remaining: 0 });
  });

  it('ignores a metric the workspace configured but may not gate on', async () => {
    const ctx = ctxFor(fixture.b);
    await setRule(ctx.tenantId, true, ['LEADS_CONVERTED']);
    await dailyTarget(ctx.tenantId, ctx.actor.id, 'LEADS_CONVERTED', 3);

    // Nothing enforceable is configured, so nothing is enforced — an outcome
    // target can never hold somebody at their desk.
    expect(await checkOutQuota(ctx, 120)).toMatchObject({ blocked: false, rows: [] });
  });

  it('ignores a weekly target — a plan is not a condition of going home', async () => {
    const ctx = ctxFor(fixture.b);
    await setRule(ctx.tenantId, true);

    const now = new Date();
    await withTx(ctx.tenantId, (tx) =>
      tx.employeeTarget.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.actor.id,
          metric: 'CALLS_ATTEMPTED',
          period: 'WEEKLY',
          targetValue: 500,
          periodStart: new Date(now.getTime() - 86_400_000),
          periodEnd: new Date(now.getTime() + 86_400_000 * 5),
        },
      }),
    );

    expect(await checkOutQuota(ctx, 120)).toMatchObject({ blocked: false, rows: [] });
  });

  it('lets somebody leave once the day has run long enough, shortfall and all', async () => {
    const ctx = ctxFor(fixture.b);
    await setRule(ctx.tenantId, true, ['CALLS_ATTEMPTED'], 9);
    await dailyTarget(ctx.tenantId, ctx.actor.id, 'CALLS_ATTEMPTED', 60);

    expect(await checkOutQuota(ctx, 8 * 60)).toMatchObject({ blocked: true });

    const late = await checkOutQuota(ctx, 9 * 60);
    expect(late.blocked).toBe(false);
    expect(late.releasedByHours).toBe(true);
    expect(late.message).toContain('60 more calls outstanding');
  });

  /**
   * Two brokerages in one city. A rule set by one must not decide whether the
   * other's agents may go home.
   */
  it('never reads another workspace’s rule or another workspace’s progress', async () => {
    const ctxA = ctxFor(fixture.a);
    const ctxB = ctxFor(fixture.b);
    await setRule(ctxA.tenantId, false);
    await setRule(ctxB.tenantId, true, ['CALLS_ATTEMPTED'], 10);

    // B's gate is on and B's target is unmet; A's is off and must stay off.
    expect(await checkOutQuota(ctxA, 60)).toMatchObject({ blocked: false, rows: [] });

    // And A's hundred logged calls count for A alone.
    const bRows = (await checkOutQuota(ctxB, 60)).rows;
    expect(bRows.every((row) => row.achieved === 0)).toBe(true);
  });

  it('measures the day from the open check-in', () => {
    const anHourAgo = new Date(Date.now() - 3_600_000);
    expect(workedMinutesSince(anHourAgo)).toBe(60);
    expect(workedMinutesSince(null)).toBeNull();
    // A clock that has drifted backwards must not read as a negative day.
    expect(workedMinutesSince(new Date(Date.now() + 60_000))).toBe(0);
  });
});
