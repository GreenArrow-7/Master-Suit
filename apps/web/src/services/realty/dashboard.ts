import type { StageCategory } from '@prisma/client';
import { withTx } from '@/lib/db';
import { mergeWhere } from '@/lib/api/where';
import { mayClaim, visibilityWhere } from '@/lib/security/visibility';
import { leadScope, workListScope } from '@/lib/security/record-scope';
import { can, scopeFor, type Ctx } from '@/lib/security/rbac';
import { CONNECTED_CALL_OUTCOMES, CONNECTED_LOG_OUTCOMES } from '@/lib/leads/callLog';
import { OPEN_FOLLOW_UP, followUpDueWhere, shiftDay } from '@/lib/leads/followUpDue';
import { SIMPLE_NAMED_LEAD_FILTERS } from '@/lib/leads/namedFilters';
import { workspaceTimezone } from '@/services/hr/attendance';
import { names } from '@/services/leadership/rollups';
import { OPEN_LEADS_WHERE } from '@/services/leads/closeOut';
import { dayBounds, todayKey } from '@/services/targets/dailyBoard';

/**
 * The brokerage dashboard, counted from rows.
 *
 * Every figure is a query against the authoritative tables SALES also reads —
 * Lead, FollowUpTask, SiteVisit, Booking, UnitInventory. Real Estate is a
 * different way to work the same data, so a number here that disagreed with the
 * Sales view of it would be a bug, not a feature.
 *
 * Scope comes from `visibilityWhere`, the same resolver the list screens use, so
 * an agent's figures are their own, a team leader's are their team's and a
 * manager's are the workspace's, without a second set of rules. `tenantId` is
 * applied on every branch of it, so no figure can cross a workspace.
 *
 * ── `null` means "not authorised to know", and never zero ───────────────────
 *
 * A dashboard spans several registers, and a viewer's permission on each is
 * configured separately. There are two ways to get this wrong, and this went
 * through both:
 *
 *   - Asking `visibilityWhere` unconditionally. It *throws* Forbidden on a NONE
 *     scope — right for a list screen, where the whole screen is refused, but it
 *     turns this board into one monolithic authorisation unit: a viewer with
 *     `leads` and without `visits` got a 403 for the entire page instead of
 *     their lead figures.
 *   - Reporting 0 instead. `0` is a claim — "you may see this, and there is
 *     nothing" — which is a different statement from "you may not see this". It
 *     also confirms the register exists and implies something about its
 *     contents, which is exactly what withholding it is meant to avoid.
 *
 * So an unauthorised register is never queried and comes back `null`, and the
 * screen omits those tiles rather than rendering a figure. The board degrades by
 * capability instead of failing whole.
 *
 * ── Labels follow the state machines, not the other way round ───────────────
 *
 *   Visits Approved     → SiteVisitStatus.APPROVED. There is no SCHEDULED; the
 *                         register is an approval workflow (REQUESTED →
 *                         APPROVED → CHECKED_IN → COMPLETED) and APPROVED is the
 *                         state meaning agreed and still to happen.
 *   Visits Completed    → COMPLETED.
 *   Bookings            → every booking not CANCELLED.
 *   Confirmed Bookings  → BookingStatus.CONFIRMED. Deliberately *not* "Won
 *                         Deals": Booking has no won/lost axis. Its states are
 *                         DRAFT, CONFIRMED and CANCELLED, and the schema defines
 *                         CANCELLED as "the sale fell through", so CONFIRMED
 *                         means the sale stands — a different claim from winning.
 *   Revenue             → sum of `saleValue` on CONFIRMED bookings, by
 *                         `bookingDate`.
 *
 * ── Which permission guards which register ──────────────────────────────────
 *
 * Read from what the existing screens assert rather than guessed: `leads` (leads
 * and follow-ups), `visits` (the site-visit register), `collections` (Booking,
 * and therefore revenue — the collections screen owns bookings, not the visits
 * one, which an earlier version of this file got wrong), `projects` (unit
 * inventory), `calls` (the Calls figures) and `tasks` (meetings booked).
 *
 * ── Every figure with its list (Lead Eagle M3) ──────────────────────────────
 *
 * A lead figure counts what the lead list shows the viewer: `leadScope` with
 * the unassigned leads they may claim, closed-out leads left out. A follow-up
 * figure counts what the Follow-ups list shows, through the same
 * `followUpDueWhere`. Each carries the link to that list, so the number and the
 * rows behind it cannot disagree. Days are the workspace's (`dayBounds`), and
 * the activity figures (calls, the leaderboard) cover the last seven of them.
 *
 * All reads but the scopes run in one read transaction, one after another on
 * one connection: thirty parallel queries each pinning its own connection is
 * the fan-out that times transactions out under load (P2028).
 */

/** A figure the viewer is not authorised to know. Never 0. */
type Figure = number | null;

/** A figure and the list, module-relative, that shows what it counted. */
export interface Tile {
  value: number;
  href: string;
}

export interface LeaderboardRow {
  userId: string;
  name: string;
  /** Calls made (placed or logged); null without `calls:VIEW`. */
  calls: number | null;
  /** Meetings booked; null without `tasks:VIEW`. */
  meetings: number | null;
  /** Site visits completed; null without `visits:VIEW`. */
  visits: number | null;
  /** Leads moved into a won stage. */
  booked: number;
  href: string;
}

export interface RealtyDashboard {
  /** Today, and the activity period (today and the six days before), as YYYY-MM-DD on the workspace's clock. */
  day: string;
  period: { from: string; to: string };
  today: { newLeads: Tile; overdue: Tile; dueToday: Tile; callbacks: Tile; siteVisits: Figure };
  pipeline: {
    totalLeads: Tile;
    /** Only for a viewer who may claim a lead. */
    unassigned: Tile | null;
    untouched: Tile;
    /** Null where the workspace has no such stage. */
    meetingsScheduled: Tile | null;
    meetingsDone: Tile | null;
    conversion: { won: number; total: number; percent: number | null; href: string };
    visitsApproved: Figure;
    visitsCompleted: Figure;
    bookings: Figure;
    confirmedBookings: Figure;
  };
  business: {
    revenueToday: Figure;
    revenue7Days: Figure;
    availableInventory: Figure;
    topAgents: { name: string; bookings: number }[] | null;
    /** Null `href`: a kind of source no list filters on. */
    leadsBySource: { label: string; count: number; href: string | null }[];
  };
  funnel: { stageId: string; name: string; category: StageCategory; count: number; href: string }[];
  /** The last 14 days, oldest first: leads received, and leads first contacted. */
  trend: { date: string; received: number; worked: number; href: string }[];
  /** Today and the six days after: follow-ups due. */
  followUpDays: { date: string; count: number; href: string }[];
  calls: { made: number; connected: number; seconds: number; href: string } | null;
  /** Top six by calls; null for a viewer who would rank only themselves. */
  leaderboard: LeaderboardRow[] | null;
}

/** Logged calls (#178's Log call, cold calls, moved history): an Activity of these types. */
const CALL_TYPES = ['call_out', 'call_in'];
/** Lead Eagle's meeting stages, by the keys its pipeline seeds (provisioning.ts). */
const MEETING_STAGES = { meetingsScheduled: 'meeting_scheduled', meetingsDone: 'meeting_done' } as const;
const SOURCE_ROWS = 8;
const LEADERBOARD_ROWS = 6;

/** "Manual", "Public form", "API": a source kind as the reports name it. */
const sourceKind = (source: string) =>
  source === 'API' ? source : source.charAt(0) + source.slice(1).toLowerCase().replace(/_/g, ' ');

const tally = <K>(map: Map<K, number>, key: K, by = 1) => map.set(key, (map.get(key) ?? 0) + by);

export async function realtyDashboard(ctx: Ctx, now = new Date()): Promise<RealtyDashboard> {
  const { tenantId } = ctx;
  const timeZone = await workspaceTimezone(ctx);
  const day = todayKey(timeZone, now);
  const onClock = (at: Date) => todayKey(timeZone, at);
  const span = (from: string, to: string) => ({ gte: dayBounds(from, timeZone).from, lte: dayBounds(to, timeZone).to });
  const today = span(day, day);
  const period = { from: shiftDay(day, -6), to: day };
  const inPeriod = span(period.from, period.to);
  const trendDays = Array.from({ length: 14 }, (_, i) => shiftDay(day, i - 13));
  const stripDays = Array.from({ length: 7 }, (_, i) => shiftDay(day, i));

  const live = { deletedAt: null };
  const confirmed = { status: 'CONFIRMED' as const };
  const may = (module: string) => can(ctx, module, 'VIEW');
  const ranks = scopeFor(ctx, 'leads', 'VIEW') !== 'OWN';

  // The lists' own scopes, resolved before the transaction: the helpers read
  // through the global client. `leads` is not optional: the page asserts
  // leads:VIEW before calling, so a viewer without it has no dashboard at all.
  const [leadsListed, followUpsListed, visitScope, dealScope, callScope, callLogScope, taskScope] = await Promise.all([
    leadScope(ctx, 'VIEW', { includeUnassigned: true }),
    workListScope(ctx, 'leads', false),
    may('visits') ? visibilityWhere(ctx, 'visits', 'VIEW', { ownerField: 'ownerId' }) : null,
    may('collections') ? visibilityWhere(ctx, 'collections', 'VIEW', { ownerField: 'ownerId' }) : null,
    may('calls') ? visibilityWhere(ctx, 'calls', 'VIEW', { ownerField: 'callerId' }) : null,
    // A logged call is its logger's, read with the same reach as the calls they placed.
    may('calls') ? visibilityWhere(ctx, 'calls', 'VIEW', { ownerField: 'ownerId' }) : null,
    may('tasks') && ranks ? workListScope(ctx, 'tasks', false) : null,
  ]);
  // What /leads and /follow-ups show this viewer.
  const leads = mergeWhere(leadsListed, OPEN_LEADS_WHERE);
  const followUps = mergeWhere(followUpsListed, OPEN_FOLLOW_UP);
  const trendSpan = span(trendDays[0]!, day);

  const read = await withTx(tenantId, async (tx) => {
    const stages = await tx.leadStage.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true, key: true, name: true, category: true },
    });
    const won = stages.filter((stage) => stage.category === 'CONVERSION').map((stage) => stage.id);
    const leadCount = (extra: Record<string, unknown> | null) => tx.lead.count({ where: mergeWhere(leads, extra) });
    return {
      stages,
      totalLeads: await leadCount(null),
      newLeads: await leadCount({ createdAt: today }),
      unassigned: mayClaim(ctx, 'leads') ? await leadCount({ ownerId: null }) : null,
      untouched: await leadCount(SIMPLE_NAMED_LEAD_FILTERS.untouched!(now, ctx.actor.id)),
      byStage: await tx.lead.groupBy({ by: ['stageId'], where: leads, _count: { _all: true } }),
      bySource: await tx.lead.groupBy({ by: ['source', 'sourceId'], where: leads, _count: { _all: true } }),
      catalogue: await tx.leadSource.findMany({
        where: { tenantId },
        select: { id: true, name: true, parentId: true },
      }),
      // ponytail: 14 days of leads read row by row; a GROUP BY on the local day if a workspace takes ~50k a fortnight.
      recent: await tx.lead.findMany({
        where: mergeWhere(leads, { OR: [{ createdAt: trendSpan }, { firstContactedAt: trendSpan }] }),
        select: { createdAt: true, firstContactedAt: true },
      }),
      overdue: await tx.followUpTask.count({
        where: mergeWhere(followUps, followUpDueWhere({ due: 'overdue' }, timeZone, now)),
      }),
      week: await tx.followUpTask.findMany({
        where: mergeWhere(followUps, { dueAt: span(day, stripDays[6]!) }),
        select: { dueAt: true, kind: true },
      }),
      visits: visitScope && [
        await tx.siteVisit.count({ where: mergeWhere(visitScope, live, { scheduledAt: today }) }),
        await tx.siteVisit.count({ where: mergeWhere(visitScope, live, { status: 'APPROVED' }) }),
        await tx.siteVisit.count({ where: mergeWhere(visitScope, live, { status: 'COMPLETED' }) }),
      ],
      deals: dealScope && {
        bookings: await tx.booking.count({ where: mergeWhere(dealScope, live, { status: { not: 'CANCELLED' } }) }),
        confirmed: await tx.booking.count({ where: mergeWhere(dealScope, live, confirmed) }),
        revenueToday: await tx.booking.aggregate({
          where: mergeWhere(dealScope, live, confirmed, { bookingDate: today }),
          _sum: { saleValue: true },
        }),
        revenue7Days: await tx.booking.aggregate({
          where: mergeWhere(dealScope, live, confirmed, { bookingDate: inPeriod }),
          _sum: { saleValue: true },
        }),
        topAgents: await tx.booking.groupBy({
          by: ['ownerId'],
          where: mergeWhere(dealScope, live, confirmed),
          _count: { _all: true },
          orderBy: { _count: { ownerId: 'desc' } },
          take: 5,
        }),
      },
      availableInventory: may('projects')
        ? await tx.unitInventory.count({ where: { tenantId, status: 'AVAILABLE' } })
        : null,
      // Calls made: placed (not merely scheduled or cancelled) or logged, in the period.
      placed: callScope
        ? await tx.call.groupBy({
            by: ['callerId', 'status', 'outcome'],
            where: mergeWhere(callScope, live, { createdAt: inPeriod, status: { notIn: ['SCHEDULED', 'CANCELLED'] } }),
            _count: { _all: true },
            _sum: { durationSecs: true },
          })
        : null,
      logged: callLogScope
        ? await tx.activity.groupBy({
            by: ['ownerId', 'outcome'],
            where: mergeWhere(callLogScope, live, { occurredAt: inPeriod, type: { is: { key: { in: CALL_TYPES } } } }),
            _count: { _all: true },
            _sum: { durationSecs: true },
          })
        : null,
      meetings: taskScope
        ? await tx.task.groupBy({
            by: ['ownerId'],
            where: mergeWhere(taskScope, live, {
              createdAt: inPeriod,
              status: { not: 'CANCELLED' },
              type: { is: { key: 'meeting' } },
            }),
            _count: { _all: true },
          })
        : null,
      visited:
        visitScope && ranks
          ? await tx.siteVisit.groupBy({
              by: ['ownerId'],
              where: mergeWhere(visitScope, live, { status: 'COMPLETED', scheduledAt: inPeriod }),
              _count: { _all: true },
            })
          : null,
      booked: ranks
        ? await tx.lead.groupBy({
            by: ['ownerId'],
            where: mergeWhere(leads, {
              stageId: { in: won },
              stageHistory: { some: { toStageId: { in: won }, createdAt: inPeriod } },
            }),
            _count: { _all: true },
          })
        : null,
    };
  });

  // Stages: the funnel, the meeting tiles and conversion, from one grouping.
  const inStage = new Map(read.byStage.map((row) => [row.stageId, row._count._all]));
  const funnel = read.stages.map((stage) => ({
    stageId: stage.id,
    name: stage.name,
    category: stage.category,
    count: inStage.get(stage.id) ?? 0,
    href: `/leads?stage=${stage.id}`,
  }));
  const stageTile = (key: string) => {
    const stage = read.stages.find((row) => row.key === key);
    return stage ? { value: inStage.get(stage.id) ?? 0, href: `/leads?stage=${stage.id}` } : null;
  };
  const won = funnel.filter((row) => row.category === 'CONVERSION').reduce((sum, row) => sum + row.count, 0);

  // Sources: the catalogue entry where a lead has one, under its top-level
  // source (the lead list's `source` takes a source with its sub-sources), else
  // its kind. Portals are top-level entries, so each is its own row.
  const entry = new Map(read.catalogue.map((row) => [row.id, row]));
  const topOf = (id: string) => {
    let row = entry.get(id);
    while (row?.parentId && entry.has(row.parentId)) row = entry.get(row.parentId);
    return row;
  };
  const bySource = new Map<string, { label: string; count: number; href: string | null }>();
  for (const row of read.bySource) {
    const top = row.sourceId ? topOf(row.sourceId) : undefined;
    const label = top?.name ?? sourceKind(row.source);
    const href = top ? `/leads?source=${top.id}` : null;
    const prior = bySource.get(label);
    // Two rows sharing a label (an entry named like a kind) fold, and no one list shows both.
    bySource.set(label, {
      label,
      count: (prior?.count ?? 0) + row._count._all,
      href: prior && prior.href !== href ? null : href,
    });
  }
  const ranked = [...bySource.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const rest = ranked.slice(SOURCE_ROWS).reduce((sum, row) => sum + row.count, 0);
  const leadsBySource = rest
    ? [...ranked.slice(0, SOURCE_ROWS), { label: 'Other sources', count: rest, href: null }]
    : ranked;

  // The 14 days: received by creation, worked by first contact.
  const received = new Map<string, number>();
  const worked = new Map<string, number>();
  const within = (at: Date | null) => !!at && at >= trendSpan.gte && at <= trendSpan.lte;
  for (const lead of read.recent) {
    if (within(lead.createdAt)) tally(received, onClock(lead.createdAt));
    if (within(lead.firstContactedAt)) tally(worked, onClock(lead.firstContactedAt!));
  }

  // The week of follow-ups; today's are the Due today and Callbacks tiles.
  const due = new Map<string, number>();
  let callbacks = 0;
  for (const followUp of read.week) {
    const date = onClock(followUp.dueAt);
    tally(due, date);
    if (date === day && followUp.kind === 'CALL') callbacks += 1;
  }

  // Calls: placed through the provider or the dialer, and logged by hand.
  const calls =
    read.placed && read.logged
      ? {
          made: [...read.placed, ...read.logged].reduce((sum, row) => sum + row._count._all, 0),
          connected:
            read.placed
              .filter(
                (row) => row.status === 'COMPLETED' && row.outcome && CONNECTED_CALL_OUTCOMES.includes(row.outcome),
              )
              .reduce((sum, row) => sum + row._count._all, 0) +
            read.logged
              .filter((row) => row.outcome && CONNECTED_LOG_OUTCOMES.includes(row.outcome))
              .reduce((sum, row) => sum + row._count._all, 0),
          seconds: [...read.placed, ...read.logged].reduce((sum, row) => sum + (row._sum.durationSecs ?? 0), 0),
          href: '/calls',
        }
      : null;

  // The leaderboard: per person, each column from its own register's scope.
  const perPerson = {
    calls: new Map<string, number>(),
    meetings: new Map<string, number>(),
    visits: new Map<string, number>(),
    booked: new Map<string, number>(),
  };
  for (const row of read.placed ?? []) tally(perPerson.calls, row.callerId, row._count._all);
  for (const row of read.logged ?? []) if (row.ownerId) tally(perPerson.calls, row.ownerId, row._count._all);
  for (const row of read.meetings ?? []) if (row.ownerId) tally(perPerson.meetings, row.ownerId, row._count._all);
  for (const row of read.visited ?? []) tally(perPerson.visits, row.ownerId, row._count._all);
  for (const row of read.booked ?? []) if (row.ownerId) tally(perPerson.booked, row.ownerId, row._count._all);
  const people = ranks ? [...new Set(Object.values(perPerson).flatMap((map) => [...map.keys()]))] : [];

  // Names in one lookup after the reads: groupBy cannot include a relation.
  const topAgentRows = read.deals?.topAgents ?? null;
  const nameOf = await names(tenantId, [...people, ...(topAgentRows?.map((row) => row.ownerId) ?? [])]);

  const leaderboard = ranks
    ? people
        .filter((userId) => nameOf.has(userId))
        .map((userId) => ({
          userId,
          name: nameOf.get(userId)!,
          calls: read.placed ? (perPerson.calls.get(userId) ?? 0) : null,
          meetings: read.meetings ? (perPerson.meetings.get(userId) ?? 0) : null,
          visits: read.visited ? (perPerson.visits.get(userId) ?? 0) : null,
          booked: perPerson.booked.get(userId) ?? 0,
          href: `/leads?owner=${userId}`,
        }))
        .sort(
          (a, b) =>
            (b.calls ?? 0) - (a.calls ?? 0) ||
            (b.meetings ?? 0) - (a.meetings ?? 0) ||
            (b.visits ?? 0) - (a.visits ?? 0) ||
            b.booked - a.booked ||
            a.name.localeCompare(b.name),
        )
        .slice(0, LEADERBOARD_ROWS)
    : null;

  const followUpTile = (due: string, value: number) => ({ value, href: `/follow-ups?due=${due}` });
  const dayList = (date: string) => `/leads?from=${date}&to=${date}`;

  return {
    day,
    period,
    today: {
      newLeads: { value: read.newLeads, href: dayList(day) },
      overdue: followUpTile('overdue', read.overdue),
      dueToday: followUpTile('today', due.get(day) ?? 0),
      callbacks: { value: callbacks, href: '/follow-ups?due=today&kind=CALL' },
      siteVisits: read.visits ? read.visits[0]! : null,
    },
    pipeline: {
      totalLeads: { value: read.totalLeads, href: '/leads' },
      unassigned: read.unassigned === null ? null : { value: read.unassigned, href: '/leads?filter=unassigned' },
      untouched: { value: read.untouched, href: '/leads?filter=untouched' },
      meetingsScheduled: stageTile(MEETING_STAGES.meetingsScheduled),
      meetingsDone: stageTile(MEETING_STAGES.meetingsDone),
      conversion: {
        won,
        total: read.totalLeads,
        percent: read.totalLeads ? Math.round((won / read.totalLeads) * 100) : null,
        href: '/leads?filter=won',
      },
      visitsApproved: read.visits ? read.visits[1]! : null,
      visitsCompleted: read.visits ? read.visits[2]! : null,
      bookings: read.deals ? read.deals.bookings : null,
      confirmedBookings: read.deals ? read.deals.confirmed : null,
    },
    business: {
      revenueToday: read.deals ? Number(read.deals.revenueToday._sum.saleValue ?? 0) : null,
      revenue7Days: read.deals ? Number(read.deals.revenue7Days._sum.saleValue ?? 0) : null,
      availableInventory: read.availableInventory,
      topAgents: topAgentRows
        ? topAgentRows
            .filter((row) => nameOf.has(row.ownerId))
            .map((row) => ({ name: nameOf.get(row.ownerId)!, bookings: row._count._all }))
        : null,
      leadsBySource,
    },
    funnel,
    trend: trendDays.map((date) => ({
      date,
      received: received.get(date) ?? 0,
      worked: worked.get(date) ?? 0,
      href: dayList(date),
    })),
    followUpDays: stripDays.map((date) => ({ date, count: due.get(date) ?? 0, href: `/follow-ups?date=${date}` })),
    calls,
    leaderboard,
  };
}
