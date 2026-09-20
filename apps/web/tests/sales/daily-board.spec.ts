import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { classify, dailyBoard, dailyCalls, dayBounds, todayKey } from '@/services/targets/dailyBoard';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * The daily lead-target board counts the day's work from the rows that record
 * it: a target, the leads called (distinct), how each call went, what came of
 * them, and whether the seller is still checked in. Two tenants seeded; the
 * second must never leak into the first's board.
 */
let fixture: Fixture;
import { buildActor, buildCtx } from '../helpers/ctx';
const ctxOf = (f: Fixture['a']) => buildCtx(buildActor({ id: f.userId, tenantId: f.tenantId }));

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const T = fixture.a.tenantId;
  const me = fixture.a.userId;
  const [l1, l2, l3, ...rest] = fixture.a.leadIds;
  const now = new Date();
  // Only three leads on the seller's desk today.
  await prisma.lead.updateMany({ where: { tenantId: T, id: { in: rest } }, data: { ownerId: null } });
  await prisma.lead.updateMany({
    where: { tenantId: T, id: { in: [l1, l2, l3] } },
    data: { ownerId: me, assignedAt: now, lastActivityAt: null, status: null },
  });
  const day = todayKey('UTC', now);
  await prisma.employeeTarget.create({
    data: {
      tenantId: T,
      userId: me,
      metric: 'LEADS_CALLED',
      period: 'DAILY',
      targetValue: 4,
      periodStart: new Date(`${day}T00:00:00.000Z`),
      periodEnd: new Date(`${day}T23:59:59.999Z`),
    },
  });
  // l1: two calls (only one lead counted), first not answered then interested.
  await prisma.call.createMany({
    data: [
      {
        tenantId: T,
        leadId: l1,
        callerId: me,
        status: 'COMPLETED',
        outcome: 'NO_ANSWER',
        durationSecs: 0,
        createdAt: now,
      },
      {
        tenantId: T,
        leadId: l1,
        callerId: me,
        status: 'COMPLETED',
        outcome: 'INTERESTED',
        durationSecs: 240,
        createdAt: now,
      },
      {
        tenantId: T,
        leadId: l2,
        callerId: me,
        status: 'COMPLETED',
        outcome: 'NOT_INTERESTED',
        durationSecs: 60,
        createdAt: now,
      },
      { tenantId: T, leadId: l3, callerId: me, status: 'MISSED', outcome: null, durationSecs: null, createdAt: now },
    ],
  });
  // The other tenant's seller called a lead today too — invisible here.
  await prisma.call.create({
    data: {
      tenantId: fixture.b.tenantId,
      leadId: fixture.b.leadIds[0],
      callerId: fixture.b.userId,
      status: 'COMPLETED',
      outcome: 'INTERESTED',
      createdAt: now,
    },
  });
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('classify', () => {
  it('sorts outcomes into what the manager reads', () => {
    expect(classify('NO_ANSWER')).toBe('notAnswered');
    expect(classify('NOT_INTERESTED')).toBe('cold');
    expect(classify('CALLBACK_REQUESTED')).toBe('warm');
    expect(classify('QUALIFIED')).toBe('interested');
    expect(classify(null)).toBe('unknown');
  });
});

describe('dayBounds', () => {
  it('covers the whole local day in the workspace time zone', () => {
    const { from, to } = dayBounds('2026-09-20', 'Asia/Dubai');
    expect(from.toISOString()).toBe('2026-09-19T20:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-20T19:59:59.999Z');
  });
});

describe('dailyBoard', () => {
  it('counts the day from calls, keeps leads distinct and shows the shortfall', async () => {
    const board = await dailyBoard(ctxOf(fixture.a));
    const me = board.rows.find((r) => r.userId === fixture.a.userId);
    expect(me).toMatchObject({
      target: 4,
      leadsAssigned: 3,
      leadsCalled: 3,
      callsCompleted: 3,
      connected: 2,
      notAnswered: 2,
      cold: 1,
      interested: 1,
      pending: 1,
      completion: 75,
      totalDurationSecs: 300,
      averageDurationSecs: 100,
      checkedOut: false,
    });
    expect(board.rows.some((r) => r.userId === fixture.b.userId)).toBe(false);
  });

  it('lists the calls behind the numbers, newest first, and hides another tenant', async () => {
    const { calls } = await dailyCalls(ctxOf(fixture.a), fixture.a.userId);
    expect(calls).toHaveLength(4);
    expect(calls.map((c) => c.kind).sort()).toEqual(['cold', 'interested', 'notAnswered', 'notAnswered']);
    const other = await dailyCalls(ctxOf(fixture.a), fixture.b.userId);
    expect(other.calls).toHaveLength(0);
    expect(other.board.rows).toHaveLength(0);
  });
});
