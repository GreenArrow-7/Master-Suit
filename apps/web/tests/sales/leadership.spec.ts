import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { activityCompliance, chasingQueue, conversion, funnel, performerBoard } from '@/services/leadership/rollups';
import { profitAndLoss } from '@/services/leadership/pl';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * M10 — the leader's numbers.
 *
 * Nothing here records anything new, so the properties worth pinning are
 * arithmetic and attribution: that a rate with no denominator says "nothing"
 * rather than "0%", that a margin missing a cost line says so instead of
 * reading as profit, and that a transfer does not move last quarter's revenue.
 */
let fixture: Fixture;
let teamA = '';
let teamB = '';
let stageOpenId = '';
let stageWonId = '';
let projectId = '';

const D = (n: number | string) => new Prisma.Decimal(n);
const RANGE = { from: new Date('2026-08-01T00:00:00Z'), to: new Date('2026-08-31T23:59:59Z') };

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const T = fixture.a.tenantId;

  const [a, b] = await Promise.all([
    prisma.team.create({
      data: { tenantId: T, name: 'Team Alpha', code: `alpha-${Math.random().toString(36).slice(2, 7)}` },
    }),
    prisma.team.create({
      data: { tenantId: T, name: 'Team Beta', code: `beta-${Math.random().toString(36).slice(2, 7)}` },
    }),
  ]);
  teamA = a.id;
  teamB = b.id;

  const stages = await prisma.leadStage.findMany({ where: { tenantId: T }, select: { id: true, category: true } });
  stageOpenId = stages.find((s) => s.category === 'OPEN')?.id ?? stages[0].id;
  const won = await prisma.leadStage.create({
    data: {
      tenantId: T,
      key: `won-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Won',
      category: 'CONVERSION',
      position: 99,
    },
  });
  stageWonId = won.id;

  const project = await prisma.project.create({
    data: { tenantId: T, name: 'Leadership project', code: `LP-${Math.random().toString(36).slice(2, 7)}` },
  });
  projectId = project.id;
});

const clear = async () => {
  for (const tenantId of [fixture.a.tenantId, fixture.b.tenantId]) {
    await prisma.commission.deleteMany({ where: { tenantId } });
    await prisma.booking.deleteMany({ where: { tenantId } });
  }
};

beforeEach(clear);

afterAll(async () => {
  await clear();
  const T = fixture.a.tenantId;
  await prisma.leadStage.deleteMany({ where: { tenantId: T, id: stageWonId } });
  await prisma.project.deleteMany({ where: { tenantId: T } });
  await prisma.team.deleteMany({ where: { tenantId: T } });
  await fixture.cleanup();
});

/** A confirmed sale, placed in a team the way the confirm route places one. */
async function sale(opts: {
  ownerId: string;
  teamId: string | null;
  saleValue: number;
  agencyFee?: number;
  commission?: number;
  when?: Date;
}) {
  return prisma.booking.create({
    data: {
      tenantId: fixture.a.tenantId,
      reference: `BK-${Math.random().toString(36).slice(2, 10)}`,
      leadId: fixture.a.leadIds[0],
      projectId,
      ownerId: opts.ownerId,
      teamId: opts.teamId,
      status: 'CONFIRMED',
      saleValue: D(opts.saleValue),
      agencyFee: opts.agencyFee === undefined ? null : D(opts.agencyFee),
      currency: 'AED',
      bookingDate: opts.when ?? new Date('2026-08-10T00:00:00Z'),
      ...(opts.commission === undefined
        ? {}
        : {
            commissions: {
              create: {
                tenantId: fixture.a.tenantId,
                userId: opts.ownerId,
                status: 'ACCRUED',
                slabVersion: 1,
                slabMode: 'FLAT',
                slabBasis: 'PERCENT_OF_SALE',
                calculation: {},
                baseAmount: D(opts.saleValue),
                sharePct: D(100),
                amount: D(opts.commission),
                currency: 'AED',
              },
            },
          }),
    },
  });
}

describe('the funnel', () => {
  it('separates what is sitting there from what actually moved', async () => {
    const rows = await funnel(fixture.a.tenantId, [], RANGE);
    const open = rows.find((r) => r.stageId === stageOpenId);

    // The seeded leads sit in the default stage and nothing has moved them, so
    // a stalled pipeline reports open without entered rather than looking busy.
    expect(open?.open).toBeGreaterThan(0);
    expect(open?.entered).toBe(0);
    expect(rows.map((r) => r.position)).toEqual([...rows.map((r) => r.position)].sort((x, y) => x - y));
  });
});

describe('conversion rates', () => {
  it('says nothing rather than zero when no leads came in', async () => {
    const empty = await conversion(fixture.a.tenantId, [], {
      from: new Date('2020-01-01T00:00:00Z'),
      to: new Date('2020-01-31T00:00:00Z'),
    });
    expect(empty.leads).toBe(0);
    // A team given no leads did not fail at anything, and 0% reads as failure.
    expect(empty.leadToBooking).toBeNull();
    expect(empty.opportunityToBooking).toBeNull();
  });

  it('counts a cancelled sale as no conversion', async () => {
    const booking = await sale({ ownerId: fixture.a.userId, teamId: teamA, saleValue: 1_000_000 });
    const before = await conversion(fixture.a.tenantId, [], RANGE);
    expect(before.bookings).toBe(1);

    await prisma.booking.update({
      where: { id: booking.id, tenantId: fixture.a.tenantId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Client withdrew' },
    });
    const after = await conversion(fixture.a.tenantId, [], RANGE);
    expect(after.bookings).toBe(0);
  });
});

describe('performer boards', () => {
  it('does not put the same person top and bottom', async () => {
    await sale({ ownerId: fixture.a.userId, teamId: teamA, saleValue: 3_000_000 });

    const board = await performerBoard(fixture.a.tenantId, [], RANGE, 'revenue');
    expect(board.top).toHaveLength(1);
    /**
     * Bottom is empty, not a copy of top.
     *
     * This assertion used to require the opposite — `bottom` deep-equal to
     * `top` — under this very name, which is how the Leadership screen came to
     * render the workspace's only seller as both "Top by revenue" and "Bottom
     * by revenue". One seller has no worst.
     */
    expect(board.bottom).toEqual([]);
    expect(board.top[0].value).toBe(3_000_000);
    expect(board.top[0].name).not.toBeNull();
  });

  it('splits top and bottom without overlap once there are enough sellers', async () => {
    // Six sellers against a limit of five: the old tail slice returned ranks
    // 1–5 as "bottom" while 0–4 were "top", so four people were both.
    const values = [6_000_000, 5_000_000, 4_000_000, 3_000_000, 2_000_000, 1_000_000];
    for (const [i, saleValue] of values.entries()) {
      await sale({ ownerId: `seller-${i}`, teamId: teamA, saleValue });
    }

    const board = await performerBoard(fixture.a.tenantId, [], RANGE, 'revenue');
    const top = board.top.map((r) => r.userId);
    const bottom = board.bottom.map((r) => r.userId);
    expect(top).toHaveLength(5);
    expect(bottom.some((id) => top.includes(id))).toBe(false);
    // Worst first in the bottom list.
    expect(bottom[0]).toBe('seller-5');
  });

  it('ranks revenue and volume differently', async () => {
    await sale({ ownerId: fixture.a.userId, teamId: teamA, saleValue: 9_000_000 });
    await sale({ ownerId: 'second-agent', teamId: teamB, saleValue: 1_000_000 });
    await sale({ ownerId: 'second-agent', teamId: teamB, saleValue: 1_000_000 });

    const byRevenue = await performerBoard(fixture.a.tenantId, [], RANGE, 'revenue');
    const byVolume = await performerBoard(fixture.a.tenantId, [], RANGE, 'bookings');
    expect(byRevenue.top[0].userId).toBe(fixture.a.userId);
    expect(byVolume.top[0].userId).toBe('second-agent');
  });

  it('shows only the subtree it was given', async () => {
    await sale({ ownerId: fixture.a.userId, teamId: teamA, saleValue: 5_000_000 });
    await sale({ ownerId: 'someone-elses-report', teamId: teamB, saleValue: 8_000_000 });

    const board = await performerBoard(fixture.a.tenantId, [fixture.a.userId], RANGE, 'revenue');
    expect(board.top).toHaveLength(1);
    expect(board.top[0].userId).toBe(fixture.a.userId);
  });
});

describe('activity compliance', () => {
  it('sums progress against the target and puts the worst first', async () => {
    const T = fixture.a.tenantId;
    const target = await prisma.employeeTarget.create({
      data: {
        tenantId: T,
        userId: fixture.a.userId,
        metric: 'CALLS_ATTEMPTED',
        period: 'DAILY',
        targetValue: 100,
        periodStart: RANGE.from,
        periodEnd: RANGE.to,
      },
    });
    await prisma.targetProgress.createMany({
      data: [
        { tenantId: T, targetId: target.id, userId: fixture.a.userId, dateKey: '2026-08-10', achieved: 30 },
        { tenantId: T, targetId: target.id, userId: fixture.a.userId, dateKey: '2026-08-11', achieved: 15 },
      ],
    });

    const rows = await activityCompliance(T, [], RANGE);
    const row = rows.find((r) => r.userId === fixture.a.userId);
    expect(row?.achieved).toBe(45);
    expect(row?.attainment).toBe(45);

    await prisma.targetProgress.deleteMany({ where: { tenantId: T, targetId: target.id } });
    await prisma.employeeTarget.deleteMany({ where: { tenantId: T, id: target.id } });
  });
});

describe('the chasing queue', () => {
  it('finds a lead whose follow-up has passed, oldest first', async () => {
    const T = fixture.a.tenantId;
    const now = new Date('2026-08-20T00:00:00Z');
    await prisma.lead.update({
      where: { id: fixture.a.leadIds[0], tenantId: T },
      data: { nextFollowUpAt: new Date('2026-08-05T00:00:00Z'), stageId: stageOpenId },
    });
    await prisma.lead.update({
      where: { id: fixture.a.leadIds[1], tenantId: T },
      data: { nextFollowUpAt: new Date('2026-08-18T00:00:00Z'), stageId: stageOpenId },
    });

    const queue = await chasingQueue(T, [], now);
    expect(queue.length).toBeGreaterThanOrEqual(2);
    // The point of a queue is that somebody works down it.
    expect(queue[0].overdueDays).toBeGreaterThanOrEqual(queue[1].overdueDays);
    expect(queue[0].leadId).toBe(fixture.a.leadIds[0]);
    expect(queue[0].overdueDays).toBe(15);

    await prisma.lead.updateMany({
      where: { tenantId: T, id: { in: [fixture.a.leadIds[0], fixture.a.leadIds[1]] } },
      data: { nextFollowUpAt: null },
    });
  });

  it('leaves a won lead alone', async () => {
    const T = fixture.a.tenantId;
    await prisma.lead.update({
      where: { id: fixture.a.leadIds[0], tenantId: T },
      data: { nextFollowUpAt: new Date('2026-08-01T00:00:00Z'), stageId: stageWonId },
    });

    const queue = await chasingQueue(T, [], new Date('2026-08-20T00:00:00Z'));
    expect(queue.map((r) => r.leadId)).not.toContain(fixture.a.leadIds[0]);

    await prisma.lead.update({
      where: { id: fixture.a.leadIds[0], tenantId: T },
      data: { nextFollowUpAt: null, stageId: stageOpenId },
    });
  });
});

describe('the P&L', () => {
  it('groups by the placement frozen on the sale, not the seller’s team today', async () => {
    await sale({
      ownerId: fixture.a.userId,
      teamId: teamA,
      saleValue: 5_000_000,
      agencyFee: 150_000,
      commission: 50_000,
    });

    const before = await profitAndLoss(fixture.a.tenantId, [], RANGE.from, RANGE.to, 'team');
    expect(before.rows.find((r) => r.key === teamA)?.agencyFee.toString()).toBe('150000');

    // The agent moves. Last quarter's revenue must not move with them.
    await prisma.userTeam.deleteMany({ where: { tenantId: fixture.a.tenantId, userId: fixture.a.userId } });
    await prisma.userTeam.create({ data: { tenantId: fixture.a.tenantId, userId: fixture.a.userId, teamId: teamB } });

    const after = await profitAndLoss(fixture.a.tenantId, [], RANGE.from, RANGE.to, 'team');
    expect(after.rows.find((r) => r.key === teamA)?.agencyFee.toString()).toBe('150000');
    expect(after.rows.find((r) => r.key === teamB)).toBeUndefined();
  });

  it('nets clawbacks off the commission cost', async () => {
    const booking = await sale({
      ownerId: fixture.a.userId,
      teamId: teamA,
      saleValue: 5_000_000,
      agencyFee: 150_000,
      commission: 50_000,
    });
    const original = await prisma.commission.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, bookingId: booking.id },
    });
    await prisma.commission.create({
      data: {
        tenantId: fixture.a.tenantId,
        bookingId: booking.id,
        userId: fixture.a.userId,
        status: 'CLAWED_BACK',
        reversesId: original.id,
        slabVersion: 1,
        slabMode: 'FLAT',
        slabBasis: 'PERCENT_OF_SALE',
        calculation: {},
        baseAmount: D(5_000_000),
        sharePct: D(100),
        amount: D(-50_000),
        currency: 'AED',
      },
    });

    const report = await profitAndLoss(fixture.a.tenantId, [], RANGE.from, RANGE.to, 'team');
    // Negative rows sum in, so no special case is needed and none can be missed.
    expect(report.rows.find((r) => r.key === teamA)?.commissionCost.toString()).toBe('0');
  });

  it('reports margin as unknown rather than as profit when payroll is missing', async () => {
    await sale({
      ownerId: fixture.a.userId,
      teamId: teamA,
      saleValue: 5_000_000,
      agencyFee: 150_000,
      commission: 50_000,
    });

    const report = await profitAndLoss(fixture.a.tenantId, [], RANGE.from, RANGE.to, 'team');
    // 150k − 50k looks like 100k of profit until you remember nobody paid the
    // staff out of it.
    expect(report.rows[0].margin).toBeNull();
    expect(report.totals.margin).toBeNull();
    expect(report.caveats.join(' ')).toMatch(/payroll/i);
  });

  it('names the bookings it could not use', async () => {
    await sale({ ownerId: fixture.a.userId, teamId: null, saleValue: 2_000_000 });

    const report = await profitAndLoss(fixture.a.tenantId, [], RANGE.from, RANGE.to, 'team');
    expect(report.rows.find((r) => r.key === null)?.name).toBe('Unassigned');
    expect(report.caveats.join(' ')).toMatch(/no agency fee/i);
    expect(report.caveats.join(' ')).toMatch(/unassigned/i);
  });

  it('excludes a second currency instead of adding it in', async () => {
    await sale({ ownerId: fixture.a.userId, teamId: teamA, saleValue: 1_000_000, agencyFee: 30_000 });
    await prisma.booking.create({
      data: {
        tenantId: fixture.a.tenantId,
        reference: `BK-${Math.random().toString(36).slice(2, 10)}`,
        leadId: fixture.a.leadIds[0],
        projectId,
        ownerId: fixture.a.userId,
        teamId: teamA,
        status: 'CONFIRMED',
        saleValue: D(9_000_000),
        agencyFee: D(400_000),
        currency: 'INR',
        bookingDate: new Date('2026-08-10T00:00:00Z'),
      },
    });

    const report = await profitAndLoss(fixture.a.tenantId, [], RANGE.from, RANGE.to, 'team');
    expect(report.currency).toBe('AED');
    expect(report.totals.agencyFee.toString()).toBe('30000');
    expect(report.caveats.join(' ')).toMatch(/INR/);
  });

  it('resolves group names rather than listing ids', async () => {
    await sale({ ownerId: fixture.a.userId, teamId: teamA, saleValue: 1_000_000, agencyFee: 30_000 });
    const report = await profitAndLoss(fixture.a.tenantId, [], RANGE.from, RANGE.to, 'team');
    expect(report.rows.find((r) => r.key === teamA)?.name).toBe('Team Alpha');
  });

  it('keeps one tenant’s revenue out of another’s report', async () => {
    await sale({ ownerId: fixture.a.userId, teamId: teamA, saleValue: 5_000_000, agencyFee: 150_000 });
    const other = await profitAndLoss(fixture.b.tenantId, [], RANGE.from, RANGE.to, 'team');
    expect(other.totals.agencyFee.toString()).toBe('0');
  });
});
