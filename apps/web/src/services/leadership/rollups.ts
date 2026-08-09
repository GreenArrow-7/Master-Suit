/**
 * What a leader looks at.
 *
 * Almost nothing here is new data. The funnel is `LeadStage` and
 * `LeadStageHistory`, compliance is `EmployeeTarget` against `TargetProgress`,
 * the feed is `Activity`, the chasing queue is `Lead.nextFollowUpAt` — all of it
 * already recorded by the modules that own it. This file is the arithmetic, and
 * the one thing it must get right is *whose* rows it counts.
 *
 * Every function takes an explicit list of user ids rather than a Ctx, so the
 * scoping decision is made once, in `subtree`, and is visible at the call site
 * instead of being re-derived differently in six places.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { resolveOwnerIds } from '@/lib/security/visibility';
import { scopeFor, type Ctx } from '@/lib/security/rbac';

export interface Range {
  from: Date;
  to: Date;
}

/**
 * The people this leader may be shown.
 *
 * Read off `reports:VIEW` rather than a permission of its own: the scope on
 * that grant already says how far down the tree somebody sees, and inventing a
 * second scope to keep in step with it is how the two end up disagreeing.
 */
export async function subtree(ctx: Ctx): Promise<string[]> {
  const scope = scopeFor(ctx, 'reports', 'VIEW');
  if (scope === 'NONE') return [];
  if (scope === 'ORGANIZATION') return [];
  return resolveOwnerIds(ctx, scope);
}

/** An empty subtree means "the whole workspace", not "nobody". */
const ownerFilter = (userIds: string[]) => (userIds.length === 0 ? {} : { ownerId: { in: userIds } });

export interface FunnelStage {
  stageId: string;
  name: string;
  category: string;
  position: number;
  /** Leads sitting here right now. */
  open: number;
  /** Leads that arrived here during the period, from the history. */
  entered: number;
}

/**
 * The funnel, both ways round.
 *
 * `open` is a snapshot — what is sitting where today. `entered` counts arrivals
 * inside the period from `LeadStageHistory`. They answer different questions and
 * reporting only the snapshot is how a team with a huge stalled pipeline looks
 * busy: nothing moved, but nothing left either.
 */
export async function funnel(tenantId: string, userIds: string[], range: Range): Promise<FunnelStage[]> {
  const [stages, open, entered] = await Promise.all([
    prisma.leadStage.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, category: true, position: true },
      orderBy: { position: 'asc' },
    }),
    prisma.lead.groupBy({
      by: ['stageId'],
      where: { tenantId, deletedAt: null, ...ownerFilter(userIds) },
      _count: { _all: true },
    }),
    prisma.leadStageHistory.groupBy({
      by: ['toStageId'],
      where: {
        tenantId,
        createdAt: { gte: range.from, lte: range.to },
        // History has no owner of its own; it belongs to whoever owns the lead.
        ...(userIds.length === 0 ? {} : { lead: { is: { ownerId: { in: userIds } } } }),
      },
      _count: { _all: true },
    }),
  ]);

  const openBy = new Map(open.map((r) => [r.stageId, r._count._all]));
  const enteredBy = new Map(entered.map((r) => [r.toStageId, r._count._all]));

  return stages.map((s) => ({
    stageId: s.id,
    name: s.name,
    category: s.category,
    position: s.position,
    open: openBy.get(s.id) ?? 0,
    entered: enteredBy.get(s.id) ?? 0,
  }));
}

export interface Conversion {
  leads: number;
  /**
   * Leads that reached a stage categorised CONVERSION.
   *
   * Not "qualified": a workspace's stage *named* Qualified is usually still
   * categorised OPEN, so a metric called qualified would be reading a different
   * thing from what it says.
   */
  converted: number;
  opportunities: number;
  bookings: number;
  /** Percentages, one decimal place. Null when the denominator is zero. */
  leadToConverted: number | null;
  leadToOpportunity: number | null;
  opportunityToBooking: number | null;
  leadToBooking: number | null;
}

/** Null rather than zero when nothing entered the top: 0% implies failure, and
 *  a team that was given no leads did not fail at anything. */
const rate = (numerator: number, denominator: number) =>
  denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;

export async function conversion(tenantId: string, userIds: string[], range: Range): Promise<Conversion> {
  const created = { gte: range.from, lte: range.to };

  const [leads, converted, opportunities, bookings] = await Promise.all([
    prisma.lead.count({ where: { tenantId, deletedAt: null, createdAt: created, ...ownerFilter(userIds) } }),
    prisma.lead.count({
      where: {
        tenantId,
        deletedAt: null,
        createdAt: created,
        // CONVERSION, not "anything but OPEN": the other two categories are
        // TERMINAL_NEGATIVE and TERMINAL_JUNK, and counting a junked lead as
        // qualified flatters every rate below.
        stage: { is: { category: 'CONVERSION' } },
        ...ownerFilter(userIds),
      },
    }),
    prisma.opportunity.count({ where: { tenantId, deletedAt: null, createdAt: created, ...ownerFilter(userIds) } }),
    prisma.booking.count({
      where: {
        tenantId,
        deletedAt: null,
        bookingDate: created,
        status: { not: 'CANCELLED' },
        ...ownerFilter(userIds),
      },
    }),
  ]);

  return {
    leads,
    converted,
    opportunities,
    bookings,
    leadToConverted: rate(converted, leads),
    leadToOpportunity: rate(opportunities, leads),
    opportunityToBooking: rate(bookings, opportunities),
    leadToBooking: rate(bookings, leads),
  };
}

export interface ComplianceRow {
  userId: string;
  metric: string;
  period: string;
  target: number;
  achieved: number;
  /** Null when the target is zero — dividing by it says nothing. */
  attainment: number | null;
}

/**
 * Targets against what actually happened.
 *
 * Reads `TargetProgress`, which the modules that do the work already write, so
 * this cannot disagree with the counters an agent sees on their own screen.
 */
export async function activityCompliance(tenantId: string, userIds: string[], range: Range): Promise<ComplianceRow[]> {
  const targets = await prisma.employeeTarget.findMany({
    where: {
      tenantId,
      periodStart: { lte: range.to },
      periodEnd: { gte: range.from },
      ...(userIds.length === 0 ? {} : { userId: { in: userIds } }),
    },
    select: {
      id: true,
      userId: true,
      metric: true,
      period: true,
      targetValue: true,
      progress: { select: { achieved: true } },
    },
  });

  return targets
    .map((t) => {
      const achieved = t.progress.reduce((sum, p) => sum + p.achieved, 0);
      return {
        userId: t.userId,
        metric: t.metric as string,
        period: t.period as string,
        target: t.targetValue,
        achieved,
        attainment: t.targetValue === 0 ? null : Math.round((achieved / t.targetValue) * 1000) / 10,
      };
    })
    .sort((a, b) => (a.attainment ?? 0) - (b.attainment ?? 0));
}

export type BoardMetric = 'bookings' | 'revenue' | 'leads' | 'activities';

export interface BoardRow {
  userId: string;
  name: string | null;
  value: number;
}

/**
 * Top and bottom of a board.
 *
 * Both ends come from one pass, because a "bottom performers" query written
 * separately is exactly where an inverted sort or a different date filter
 * quietly creeps in and puts somebody on the wrong list.
 */
export async function performerBoard(
  tenantId: string,
  userIds: string[],
  range: Range,
  metric: BoardMetric,
  limit = 5,
): Promise<{ top: BoardRow[]; bottom: BoardRow[] }> {
  const rows = await rank(tenantId, userIds, range, metric);

  const names = await prisma.user.findMany({
    where: { tenantId, id: { in: rows.map((r) => r.userId) } },
    select: { id: true, fullName: true },
  });
  const nameBy = new Map(names.map((u) => [u.id, u.fullName]));
  const withNames = rows.map((r) => ({ ...r, name: nameBy.get(r.userId) ?? null }));

  return {
    top: withNames.slice(0, limit),
    // Not `.reverse()` of the top slice: with fewer people than `limit` that
    // would show the same person at both ends.
    bottom: withNames.slice(-limit).reverse(),
  };
}

async function rank(
  tenantId: string,
  userIds: string[],
  range: Range,
  metric: BoardMetric,
): Promise<{ userId: string; value: number }[]> {
  const within = { gte: range.from, lte: range.to };

  if (metric === 'revenue' || metric === 'bookings') {
    const rows = await prisma.booking.groupBy({
      by: ['ownerId'],
      where: {
        tenantId,
        deletedAt: null,
        bookingDate: within,
        status: { not: 'CANCELLED' },
        ...ownerFilter(userIds),
      },
      _count: { _all: true },
      _sum: { saleValue: true },
    });
    return rows
      .map((r) => ({
        userId: r.ownerId,
        value: metric === 'bookings' ? r._count._all : Number((r._sum.saleValue ?? new Prisma.Decimal(0)).toString()),
      }))
      .sort((a, b) => b.value - a.value);
  }

  if (metric === 'leads') {
    const rows = await prisma.lead.groupBy({
      by: ['ownerId'],
      where: { tenantId, deletedAt: null, createdAt: within, ...ownerFilter(userIds) },
      _count: { _all: true },
    });
    return rows
      .filter((r): r is typeof r & { ownerId: string } => r.ownerId !== null)
      .map((r) => ({ userId: r.ownerId, value: r._count._all }))
      .sort((a, b) => b.value - a.value);
  }

  const rows = await prisma.activity.groupBy({
    by: ['ownerId'],
    where: { tenantId, occurredAt: within, ...ownerFilter(userIds) },
    _count: { _all: true },
  });
  return rows
    .filter((r): r is typeof r & { ownerId: string } => r.ownerId !== null)
    .map((r) => ({ userId: r.ownerId, value: r._count._all }))
    .sort((a, b) => b.value - a.value);
}

/** What the team has been doing, newest first. */
export async function interactionFeed(tenantId: string, userIds: string[], range: Range, limit = 50) {
  return prisma.activity.findMany({
    where: { tenantId, occurredAt: { gte: range.from, lte: range.to }, ...ownerFilter(userIds) },
    select: {
      id: true,
      ownerId: true,
      occurredAt: true,
      outcome: true,
      status: true,
      type: { select: { name: true } },
      lead: { select: { id: true, fullName: true } },
    },
    orderBy: { occurredAt: 'desc' },
    take: limit,
  });
}

export interface ChasingRow {
  leadId: string;
  fullName: string;
  ownerId: string | null;
  nextFollowUpAt: Date | null;
  lastActivityAt: Date | null;
  slaState: string;
  overdueDays: number;
}

/**
 * The leads nobody has gone back to.
 *
 * Deliberately built from the follow-up date rather than from a task list: a
 * lead with no task at all is the one most likely to be forgotten, and a queue
 * that only shows overdue *tasks* cannot see it. Sorted oldest first, because
 * the point of the queue is that somebody works down it.
 */
export async function chasingQueue(tenantId: string, userIds: string[], now = new Date(), limit = 100) {
  const rows = await prisma.lead.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...ownerFilter(userIds),
      stage: { is: { category: 'OPEN' } },
      OR: [{ nextFollowUpAt: { lt: now } }, { nextFollowUpAt: null, slaState: { in: ['BREACHED', 'AT_RISK'] } }],
    },
    select: {
      id: true,
      fullName: true,
      ownerId: true,
      nextFollowUpAt: true,
      lastActivityAt: true,
      slaState: true,
    },
    orderBy: [{ nextFollowUpAt: 'asc' }, { lastActivityAt: 'asc' }],
    take: limit,
  });

  const DAY = 86_400_000;
  return rows.map((r): ChasingRow => {
    const since = r.nextFollowUpAt ?? r.lastActivityAt;
    return {
      leadId: r.id,
      fullName: r.fullName,
      ownerId: r.ownerId,
      nextFollowUpAt: r.nextFollowUpAt,
      lastActivityAt: r.lastActivityAt,
      slaState: r.slaState,
      overdueDays: since ? Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY)) : 0,
    };
  });
}
