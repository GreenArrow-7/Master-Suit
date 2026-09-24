import { prisma } from '@/lib/db';
import { mergeWhere } from '@/lib/api/where';
import { visibilityWhere } from '@/lib/security/visibility';
import { can, type Ctx } from '@/lib/security/rbac';

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
 * one, which an earlier version of this file got wrong), and `projects` (unit
 * inventory).
 */

/** A figure the viewer is not authorised to know. Never 0. */
type Figure = number | null;

export interface RealtyDashboard {
  today: { newLeads: number; callbacks: number; followUps: number; siteVisits: Figure };
  pipeline: {
    totalLeads: number;
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
    leadsBySource: { source: string; count: number }[];
  };
}

/** Start of today, start of tomorrow, and the first day of the last-7-days window. */
function windows(now: Date) {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const sevenDaysAgo = new Date(startOfToday);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  return { startOfToday, endOfToday, sevenDaysAgo };
}

export async function realtyDashboard(ctx: Ctx, now = new Date()): Promise<RealtyDashboard> {
  const { startOfToday, endOfToday, sevenDaysAgo } = windows(now);

  const live = { deletedAt: null };
  const today = { gte: startOfToday, lt: endOfToday };
  const confirmed = { status: 'CONFIRMED' as const };

  // `leads` is not optional: the page asserts leads:VIEW before calling, so a
  // viewer without it has no dashboard at all, which is the intended answer.
  const leadScope = await visibilityWhere(ctx, 'leads', 'VIEW', { ownerField: 'ownerId' });
  const visitScope = can(ctx, 'visits', 'VIEW')
    ? await visibilityWhere(ctx, 'visits', 'VIEW', { ownerField: 'ownerId' })
    : null;
  const dealScope = can(ctx, 'collections', 'VIEW')
    ? await visibilityWhere(ctx, 'collections', 'VIEW', { ownerField: 'ownerId' })
    : null;
  const maySeeInventory = can(ctx, 'projects', 'VIEW');

  const [newLeads, totalLeads, followUps, callbacks, bySource] = await Promise.all([
    prisma.lead.count({ where: mergeWhere(leadScope, live, { createdAt: today }) }),
    prisma.lead.count({ where: mergeWhere(leadScope, live) }),
    // Everything still open and due by the end of today — today's work plus
    // whatever was missed.
    prisma.followUpTask.count({
      where: mergeWhere(leadScope, live, { status: { notIn: ['COMPLETED', 'CANCELLED'] }, dueAt: { lt: endOfToday } }),
    }),
    // Due today specifically: "ring these people back", a different question
    // from "what am I behind on".
    prisma.followUpTask.count({
      where: mergeWhere(leadScope, live, { status: { notIn: ['COMPLETED', 'CANCELLED'] }, dueAt: today }),
    }),
    prisma.lead.groupBy({
      by: ['source'],
      where: mergeWhere(leadScope, live),
      _count: { _all: true },
      orderBy: { _count: { source: 'desc' } },
      take: 5,
    }),
  ]);

  const visits = visitScope
    ? await Promise.all([
        prisma.siteVisit.count({ where: mergeWhere(visitScope, live, { scheduledAt: today }) }),
        prisma.siteVisit.count({ where: mergeWhere(visitScope, live, { status: 'APPROVED' }) }),
        prisma.siteVisit.count({ where: mergeWhere(visitScope, live, { status: 'COMPLETED' }) }),
      ])
    : null;

  const deals = dealScope
    ? await Promise.all([
        prisma.booking.count({ where: mergeWhere(dealScope, live, { status: { not: 'CANCELLED' } }) }),
        prisma.booking.count({ where: mergeWhere(dealScope, live, confirmed) }),
        prisma.booking.aggregate({
          where: mergeWhere(dealScope, live, confirmed, { bookingDate: today }),
          _sum: { saleValue: true },
        }),
        prisma.booking.aggregate({
          where: mergeWhere(dealScope, live, confirmed, { bookingDate: { gte: sevenDaysAgo, lt: endOfToday } }),
          _sum: { saleValue: true },
        }),
        prisma.booking.groupBy({
          by: ['ownerId'],
          where: mergeWhere(dealScope, live, confirmed),
          _count: { _all: true },
          orderBy: { _count: { ownerId: 'desc' } },
          take: 5,
        }),
      ])
    : null;

  const availableInventory = maySeeInventory
    ? await prisma.unitInventory.count({ where: { tenantId: ctx.tenantId, status: 'AVAILABLE' } })
    : null;

  // Names in a second query rather than a join: groupBy cannot include a
  // relation, and five ids is a cheaper lookup than widening the aggregate.
  const topAgentRows = deals ? deals[4] : null;
  const agents =
    topAgentRows && topAgentRows.length
      ? await prisma.user.findMany({
          where: { tenantId: ctx.tenantId, id: { in: topAgentRows.map((row) => row.ownerId) } },
          select: { id: true, fullName: true },
        })
      : [];
  const nameOf = new Map(agents.map((agent) => [agent.id, agent.fullName]));

  return {
    today: { newLeads, callbacks, followUps, siteVisits: visits ? visits[0] : null },
    pipeline: {
      totalLeads,
      visitsApproved: visits ? visits[1] : null,
      visitsCompleted: visits ? visits[2] : null,
      bookings: deals ? deals[0] : null,
      confirmedBookings: deals ? deals[1] : null,
    },
    business: {
      revenueToday: deals ? Number(deals[2]._sum.saleValue ?? 0) : null,
      revenue7Days: deals ? Number(deals[3]._sum.saleValue ?? 0) : null,
      availableInventory,
      topAgents: topAgentRows
        ? topAgentRows
            .filter((row) => nameOf.has(row.ownerId))
            .map((row) => ({ name: nameOf.get(row.ownerId)!, bookings: row._count._all }))
        : null,
      leadsBySource: bySource.map((row) => ({ source: String(row.source), count: row._count._all })),
    },
  };
}
