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

  /**
   * Bottom is the tail that is not already in the top.
   *
   * `slice(-limit)` alone does not achieve that: with six sellers and a limit of
   * five, top is 0–4 and the tail is 1–5, so four people were listed as both the
   * best and the worst on the same screen. Ranking the same person twice is not
   * a second insight, and being named "bottom" while also being "top" is a thing
   * a manager acts on. Below `limit` sellers there is no bottom to show at all.
   */
  const top = withNames.slice(0, limit);
  const rest = withNames.slice(limit);
  return { top, bottom: rest.slice(-limit).reverse() };
}

/**
 * The ordered standings for one metric. Exported because a contest is the same
 * question over a different window, and two rankings of "who sold the most"
 * would eventually disagree.
 */
export async function rank(
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

import { obligationWhere, scopedNextFollowUp, stateOf, type ObligationAccess } from '@/services/leads/nextFollowUp';

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
 * How many candidates to consider before trimming to `limit`.
 *
 * The stored column is a *lower* bound on what any given viewer may see — it
 * aggregates every owner, the scoped value only some — so ordering by it and
 * truncating in SQL can drop a lead that belongs in the viewer's top N. The
 * scoped dates are therefore computed for a wider candidate set and the trim
 * happens after.
 *
 * ponytail: oversample and trim; move the ordering into the obligation tables
 * if a workspace ever has more than this many chaseable leads at once.
 */
const CHASING_CANDIDATES = 500;

/**
 * The leads nobody has gone back to.
 *
 * Deliberately built from the follow-up date rather than from a task list: a
 * lead with no task at all is the one most likely to be forgotten, and a queue
 * that only shows overdue *tasks* cannot see it. Sorted oldest first, because
 * the point of the queue is that somebody works down it.
 *
 * Two conditions, kept apart, because they are different problems: something is
 * owed and late, or nothing is owed at all on a lead the SLA already considers
 * in trouble. The second is the neglect case — it has no date, and pairing it
 * with an `slaState` is the only thing that distinguishes "forgotten" from
 * "nothing due yet".
 *
 * Closed leads are excluded from both. A lead nobody will follow up because it
 * is won or lost is not neglected, and listing it here buries the ones that are.
 */
export async function chasingQueue(
  tenantId: string,
  userIds: string[],
  access: ObligationAccess,
  now = new Date(),
  limit = 100,
) {
  const rows = await prisma.lead.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...ownerFilter(userIds),
      stage: { is: { category: 'OPEN' } },
      OR: [
        obligationWhere(access, 'overdue', now),
        { AND: [obligationWhere(access, 'unscheduled', now), { slaState: { in: ['BREACHED', 'AT_RISK'] } }] },
      ],
    },
    select: {
      id: true,
      fullName: true,
      ownerId: true,
      lastActivityAt: true,
      slaState: true,
    },
    orderBy: [{ lastActivityAt: 'asc' }, { id: 'asc' }],
    take: CHASING_CANDIDATES,
  });

  const due = await scopedNextFollowUp(
    tenantId,
    rows.map((r) => r.id),
    access,
  );

  const DAY = 86_400_000;
  return rows
    .map((r): ChasingRow => {
      const nextFollowUpAt = due.get(r.id) ?? null;
      // Overdue is measured from the date that is late; a lead with nothing
      // scheduled is measured from when anyone last touched it, which is the
      // only clock it has.
      const since = nextFollowUpAt ?? r.lastActivityAt;
      return {
        leadId: r.id,
        fullName: r.fullName,
        ownerId: r.ownerId,
        nextFollowUpAt,
        lastActivityAt: r.lastActivityAt,
        slaState: r.slaState,
        overdueDays: since ? Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY)) : 0,
      };
    })
    .sort((a, b) => {
      // Dated rows first, oldest first; undated ones after, by last activity.
      // Ties break on lead id so the queue is the same list twice running.
      const ad = stateOf(a.nextFollowUpAt, now) === 'unscheduled';
      const bd = stateOf(b.nextFollowUpAt, now) === 'unscheduled';
      if (ad !== bd) return ad ? 1 : -1;
      const av = (a.nextFollowUpAt ?? a.lastActivityAt)?.getTime() ?? Infinity;
      const bv = (b.nextFollowUpAt ?? b.lastActivityAt)?.getTime() ?? Infinity;
      if (av !== bv) return av - bv;
      return a.leadId < b.leadId ? -1 : a.leadId > b.leadId ? 1 : 0;
    })
    .slice(0, limit);
}

export interface ProductivityRow {
  userId: string;
  name: string | null;
  /** Leads handed to this person in the range. */
  assigned: number;
  /** Distinct leads this person called or logged an activity against in the range. */
  contacted: number;
  callsCompleted: number;
  followUpsCompleted: number;
  interested: number;
  notInterested: number;
  meetingsScheduled: number;
  dealsWon: number;
  /** Leads this person owns that nobody has ever touched. */
  pending: number;
}

/**
 * What each seller did with what they were given: assigned → contacted →
 * outcomes → deals, and how much is still untouched. Every number is a count
 * the person can be shown the rows for; nothing here is a score.
 */
export async function productivity(tenantId: string, userIds: string[], range: Range): Promise<ProductivityRow[]> {
  const within = { gte: range.from, lte: range.to };
  const owner = ownerFilter(userIds);
  const caller = userIds.length === 0 ? {} : { callerId: { in: userIds } };

  const [assigned, calls, touchedByActivity, touchedByCall, tasks, meetings, deals, pending, users] = await Promise.all(
    [
      prisma.lead.groupBy({
        by: ['ownerId'],
        where: { tenantId, deletedAt: null, assignedAt: within, ...owner },
        _count: { _all: true },
      }),
      prisma.call.groupBy({
        by: ['callerId', 'outcome'],
        where: { tenantId, deletedAt: null, status: 'COMPLETED', createdAt: within, ...caller },
        _count: { _all: true },
      }),
      prisma.activity.findMany({
        where: { tenantId, occurredAt: within, leadId: { not: null }, ...owner },
        select: { ownerId: true, leadId: true },
        distinct: ['ownerId', 'leadId'],
      }),
      prisma.call.findMany({
        where: { tenantId, deletedAt: null, createdAt: within, leadId: { not: null }, ...caller },
        select: { callerId: true, leadId: true },
        distinct: ['callerId', 'leadId'],
      }),
      prisma.task.groupBy({
        by: ['ownerId'],
        where: { tenantId, status: 'COMPLETED', completedAt: within, ...owner },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ['ownerId'],
        where: { tenantId, createdAt: within, type: { key: 'meeting' }, ...owner },
        _count: { _all: true },
      }),
      prisma.opportunity.groupBy({
        by: ['ownerId'],
        where: { tenantId, deletedAt: null, status: 'WON', updatedAt: within, ...owner },
        _count: { _all: true },
      }),
      prisma.lead.groupBy({
        by: ['ownerId'],
        where: { tenantId, deletedAt: null, lastActivityAt: null, status: null, ...owner },
        _count: { _all: true },
      }),
      prisma.user.findMany({
        where: { tenantId, deletedAt: null, ...(userIds.length === 0 ? {} : { id: { in: userIds } }) },
        select: { id: true, fullName: true },
      }),
    ],
  );

  const rows = new Map<string, ProductivityRow>();
  const row = (userId: string) => {
    let r = rows.get(userId);
    if (!r) {
      r = {
        userId,
        name: null,
        assigned: 0,
        contacted: 0,
        callsCompleted: 0,
        followUpsCompleted: 0,
        interested: 0,
        notInterested: 0,
        meetingsScheduled: 0,
        dealsWon: 0,
        pending: 0,
      };
      rows.set(userId, r);
    }
    return r;
  };
  for (const u of users) row(u.id).name = u.fullName;
  for (const g of assigned) if (g.ownerId) row(g.ownerId).assigned += g._count._all;
  for (const g of calls) {
    const r = row(g.callerId);
    r.callsCompleted += g._count._all;
    if (g.outcome === 'INTERESTED' || g.outcome === 'QUALIFIED' || g.outcome === 'CONVERTED')
      r.interested += g._count._all;
    if (g.outcome === 'NOT_INTERESTED' || g.outcome === 'WRONG_NUMBER') r.notInterested += g._count._all;
  }
  const touched = new Map<string, Set<string>>();
  for (const t of [...touchedByActivity, ...touchedByCall]) {
    const userId = 'ownerId' in t ? t.ownerId : t.callerId;
    if (!userId || !t.leadId) continue;
    if (!touched.has(userId)) touched.set(userId, new Set());
    touched.get(userId)!.add(t.leadId);
  }
  for (const [userId, leads] of touched) row(userId).contacted = leads.size;
  for (const g of tasks) if (g.ownerId) row(g.ownerId).followUpsCompleted += g._count._all;
  for (const g of meetings) if (g.ownerId) row(g.ownerId).meetingsScheduled += g._count._all;
  for (const g of deals) if (g.ownerId) row(g.ownerId).dealsWon += g._count._all;
  for (const g of pending) if (g.ownerId) row(g.ownerId).pending += g._count._all;

  return [...rows.values()].sort((a, b) => b.assigned - a.assigned || (a.name ?? '').localeCompare(b.name ?? ''));
}

export interface WorkspaceValue {
  /** Work the platform did for this workspace in the range, and the hours it stands in for. */
  leadsImported: number;
  callsAnalysed: number;
  automationSucceeded: number;
  automationFailed: number;
  leadsAutoAssigned: number;
  hoursSaved: number;
  /** Analyses a person corrected, over analyses produced by a model. */
  humanInterventionRate: number | null;
  /** Average days from an opportunity's creation to it being won, for deals won in the range. */
  dealTurnaroundDays: number | null;
  dealsWon: number;
  /** Tokens spent this month on the shared key and on the workspace's own key. */
  aiTokensThisMonth: { deployment: number; workspace: number };
}

/**
 * §16: what the platform saved and delivered for one workspace. Every figure is a
 * count of rows in the range; the hours use the same stated per-action minutes as
 * the front door (lib/value/platformValue.ts), so the two never disagree.
 */
export async function workspaceValue(tenantId: string, range: Range): Promise<WorkspaceValue> {
  const within = { gte: range.from, lte: range.to };
  const { valueSummary } = await import('@/lib/value/platformValue');
  const { usageMetric } = await import('@/lib/ai/usage');
  const [
    leadsImported,
    callsAnalysed,
    corrected,
    automationSucceeded,
    automationFailed,
    leadsAutoAssigned,
    won,
    usage,
  ] = await Promise.all([
    prisma.lead.count({ where: { tenantId, source: 'IMPORT', createdAt: within } }),
    prisma.aIAnalysis.count({
      where: { tenantId, status: 'COMPLETED', modelId: { not: 'demo-simulation' }, createdAt: within },
    }),
    prisma.aIAnalysis.count({
      where: {
        tenantId,
        status: 'COMPLETED',
        modelId: { not: 'demo-simulation' },
        humanCorrected: true,
        createdAt: within,
      },
    }),
    prisma.automationExecution.count({ where: { tenantId, status: 'SUCCEEDED', startedAt: within } }),
    prisma.automationExecution.count({ where: { tenantId, status: 'FAILED', startedAt: within } }),
    prisma.leadAssignmentHistory.count({ where: { tenantId, method: { not: null }, createdAt: within } }),
    prisma.opportunity.findMany({
      where: { tenantId, deletedAt: null, status: 'WON', updatedAt: within },
      select: { createdAt: true, updatedAt: true },
    }),
    prisma.workspaceUsage.findMany({
      where: { tenantId, metric: { in: [usageMetric('deployment'), usageMetric('workspace')] } },
      select: { metric: true, used: true },
    }),
  ]);
  const summary = valueSummary({
    leadsImported,
    callsAnalysed,
    automationSteps: automationSucceeded,
    leadsAutoAssigned,
  });
  const turnaround = won.length
    ? won.reduce((sum, o) => sum + (o.updatedAt.getTime() - o.createdAt.getTime()), 0) / won.length / 86_400_000
    : null;
  return {
    leadsImported,
    callsAnalysed,
    automationSucceeded,
    automationFailed,
    leadsAutoAssigned,
    hoursSaved: summary.hoursSaved,
    humanInterventionRate: callsAnalysed ? Math.round((corrected / callsAnalysed) * 1000) / 10 : null,
    dealTurnaroundDays: turnaround === null ? null : Math.round(turnaround * 10) / 10,
    dealsWon: won.length,
    aiTokensThisMonth: {
      deployment: usage.find((u) => u.metric === usageMetric('deployment'))?.used ?? 0,
      workspace: usage.find((u) => u.metric === usageMetric('workspace'))?.used ?? 0,
    },
  };
}
