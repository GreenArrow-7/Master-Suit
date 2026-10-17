/**
 * The reports behind the report menu.
 *
 * That page listed ten reports and linked every one of them to `?report=…`,
 * which nothing handled — so the menu described a feature that did not exist.
 * Each of the ten is answerable from data other modules already record, so this
 * file answers them rather than the menu being trimmed.
 *
 * Every report returns the same `{ columns, rows }` shape on purpose. Ten
 * bespoke renderers is ten places to get alignment, empty states and CSV
 * escaping subtly different; one shape means one table component and one export.
 */
import { Prisma } from '@prisma/client';
import { prismaRead } from '@/lib/db';
import { csvHeader, csvRow, type CsvColumn } from '@/lib/csv';
import { conversion, funnel, names, rank, subtree, type Range } from './rollups';
import type { Ctx } from '@/lib/security/rbac';
import { Invalid } from '@/lib/errors';
import { LEAD_SOURCES } from '@/lib/integrations/leadSources';
import { callTab, LOGGED_CALL } from '@/lib/leads/boardFilter';
import { CONNECTED_CALL_OUTCOMES, CONNECTED_LOG_OUTCOMES } from '@/lib/leads/callLog';
import { leadSourceLabel } from '@/services/leads/leadSources';
import { workspaceTimezone } from '@/services/hr/attendance';
import { dayBounds, todayKey } from '@/services/targets/dailyBoard';

/**
 * Every query in this module goes to `prismaRead` — the replica when
 * `DATABASE_REPLICA_URL` is set, the primary otherwise.
 *
 * These are the reads that can afford to be a moment behind: a report is a
 * roll-up over a date range, and one computed 200ms ago is the same report. They
 * are also the heaviest reads in the product — groupBy over a quarter of leads
 * or attendance punches — which is exactly the traffic worth keeping off the
 * connections that are serving writes.
 *
 * `prismaRead` refuses write operations, in every configuration including the
 * no-replica fallback, so a write added here fails on the first run rather than
 * only where a replica exists. See lib/db.ts.
 */

export const REPORT_KEYS = [
  'lead-conversion',
  'pipeline-summary',
  'activity-log',
  'revenue-forecast',
  'team-performance',
  'rep-activity',
  'lead-assignment',
  'campaign-performance',
  'source-analysis',
  'lead-quality',
  'follow-up-adherence',
  'source-to-booking',
  'project-report',
  'site-visits',
  'call-report',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

/** What a report's rows can be regrouped by (M16-13): `?by=`, the same query keyed another way. */
export const PIVOT_KEYS = ['user', 'month', 'project', 'lead'] as const;
export type Pivot = (typeof PIVOT_KEYS)[number];
/** The groupings each report offers, its default first. A report missing here has one shape. */
export const PIVOTS: Partial<Record<ReportKey, readonly Pivot[]>> = {
  'activity-log': ['user', 'month'],
  'follow-up-adherence': ['user', 'month'],
  'site-visits': ['user', 'project', 'month'],
  'call-report': ['user', 'lead', 'month'],
};
const PIVOT_COLUMN: Record<Pivot, Column> = {
  user: { key: 'agent', label: 'Agent' },
  month: { key: 'month', label: 'Month' },
  project: { key: 'project', label: 'Project' },
  lead: { key: 'lead', label: 'Lead' },
};

/** The file a report downloads or is mailed as: `call-report-by-lead-2026-10-17.csv`. */
export const reportFileName = (key: ReportKey, by: Pivot | undefined, at: Date) =>
  `${key}${by ? `-by-${by}` : ''}-${at.toISOString().slice(0, 10)}.csv`;

export interface Column {
  key: string;
  label: string;
  align?: 'right';
}

export type Cell = string | number | null;

export interface Report {
  key: ReportKey;
  title: string;
  columns: Column[];
  rows: Record<string, Cell>[];
  /** What the numbers do not cover, when that is not obvious. */
  note?: string;
}

const pct = (n: number | null) => (n === null ? null : `${n}%`);

const money = (amount: Prisma.Decimal | null, currency = 'AED') =>
  amount === null ? null : `${currency} ${Number(amount.toString()).toLocaleString('en-GB')}`;

/** Empty user list means the whole workspace, matching the rollups module. */
const owned = (userIds: string[]) => (userIds.length === 0 ? {} : { ownerId: { in: userIds } });

/**
 * Where a lead came from, finer than its RecordSource: Marketplace is three
 * portals, and the intake writes which one into `sourceDetail` (`bayut:…`),
 * as Meta, QR capture and cold data do (`facebook:`, `capture:`, `data:`).
 */
const SOURCE_DETAIL: Record<string, string> = {
  ...Object.fromEntries(Object.entries(LEAD_SOURCES).map(([key, { label }]) => [key, label])),
  facebook: 'Facebook lead ads',
  capture: 'QR capture',
  data: 'Cold data',
};
const sourceLabel = (source: string, detail: string | null) => {
  // A referral's detail is whoever referred it, typed by hand: never an intake key.
  const key = source === 'REFERRAL' ? '' : (detail?.split(':')[0] ?? '');
  return Object.hasOwn(SOURCE_DETAIL, key)
    ? SOURCE_DETAIL[key]!
    : source === 'API'
      ? source
      : source.charAt(0) + source.slice(1).toLowerCase().replace(/_/g, ' ');
};
/** The workspace's catalogue entry where the lead has one (M4-03), else the label above. */
const catalogueLabel = (lead: {
  source: string;
  sourceDetail: string | null;
  leadSource: Parameters<typeof leadSourceLabel>[0];
}) => leadSourceLabel(lead.leadSource, ' / ') ?? sourceLabel(lead.source, lead.sourceDetail);
const LEAD_SOURCE = { select: { name: true, parent: { select: { name: true } } } };

type Within = { gte: Date; lte: Date };
const MAX_MONTHS = 36;
/** `2026-12` → `2027-01`: Date.UTC's months count from 0, so the 1-based month is the next one. */
export const nextMonth = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7);

/**
 * One read per calendar month on the workspace's clock, each clipped to the
 * range: a groupBy cannot bucket by date, and a month must not be the server's.
 * ponytail: one query per month in turn (36 at most); a date_trunc GROUP BY if month pivots get slow.
 */
async function perMonth<T>(ctx: Ctx, range: Range, read: (within: Within, month: string) => Promise<T[]>) {
  const zone = await workspaceTimezone(ctx);
  const last = todayKey(zone, range.to).slice(0, 7);
  const out: T[] = [];
  for (let month = todayKey(zone, range.from).slice(0, 7), n = 0; month <= last; month = nextMonth(month), n++) {
    if (n === MAX_MONTHS) {
      throw Invalid([
        { field: 'from', code: 'too_long', message: `By month, a report covers ${MAX_MONTHS} months at most.` },
      ]);
    }
    const start = dayBounds(`${month}-01`, zone).from;
    const end = new Date(dayBounds(`${nextMonth(month)}-01`, zone).from.getTime() - 1);
    const within = { gte: start > range.from ? start : range.from, lte: end < range.to ? end : range.to };
    out.push(...(await read(within, month)));
  }
  return out;
}

/** What a pivot's keys read as: a person's name, a lead's, a project's, or the month itself. */
async function pivotLabels(tenantId: string, by: Pivot, keys: (string | null)[]) {
  if (by === 'month') return (key: string | null) => key ?? '';
  if (by === 'user') {
    const who = await names(tenantId, keys);
    return (key: string | null) => (key ? (who.get(key) ?? 'Unknown') : 'Unassigned');
  }
  const ids = [...new Set(keys.filter((k): k is string => k !== null))];
  const found =
    by === 'lead'
      ? (
          await prismaRead.lead.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, fullName: true } })
        ).map((l) => [l.id, l.fullName] as const)
      : (
          await prismaRead.project.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true } })
        ).map((p) => [p.id, p.name] as const);
  const name = new Map(found);
  const [removed, none] = by === 'lead' ? ['Removed lead', 'No lead'] : ['Removed project', 'No project'];
  return (key: string | null) => (key ? (name.get(key) ?? removed) : none);
}

/** Months in order; anything else by its count, largest first. */
const pivotOrder = (by: Pivot, count: string) => (a: Record<string, Cell>, b: Record<string, Cell>) =>
  by === 'month' ? String(a.month).localeCompare(String(b.month)) : Number(b[count]) - Number(a[count]);

/** A visit that took place: the agent punched in with the client, or finished. */
const VISITED = ['CHECKED_IN', 'COMPLETED'] as const;

export async function runReport(ctx: Ctx, key: ReportKey, range: Range, { by }: { by?: Pivot } = {}): Promise<Report> {
  const tenantId = ctx.tenantId;
  const userIds = await subtree(ctx);
  const within = { gte: range.from, lte: range.to };
  const pivot = by ?? PIVOTS[key]?.[0] ?? 'user';

  switch (key) {
    case 'lead-conversion': {
      const c = await conversion(tenantId, userIds, range);
      return {
        key,
        title: 'Lead conversion rate',
        columns: [
          { key: 'step', label: 'Step' },
          { key: 'count', label: 'Count', align: 'right' },
          { key: 'rate', label: 'Of leads in', align: 'right' },
        ],
        rows: [
          { step: 'Leads in', count: c.leads, rate: null },
          { step: 'Reached a conversion stage', count: c.converted, rate: pct(c.leadToConverted) },
          { step: 'Became an opportunity', count: c.opportunities, rate: pct(c.leadToOpportunity) },
          { step: 'Became a booking', count: c.bookings, rate: pct(c.leadToBooking) },
        ],
        note: 'A rate with no leads behind it is blank rather than 0%.',
      };
    }

    case 'pipeline-summary': {
      const [stages, value] = await Promise.all([
        funnel(tenantId, userIds, range),
        prismaRead.opportunity.groupBy({
          by: ['stageId'],
          where: { tenantId, deletedAt: null, status: 'OPEN', ...owned(userIds) },
          _sum: { amount: true },
          _count: { _all: true },
        }),
      ]);
      const valueBy = new Map(value.map((v) => [v.stageId, v]));
      return {
        key,
        title: 'Sales pipeline summary',
        columns: [
          { key: 'stage', label: 'Stage' },
          { key: 'open', label: 'Leads sitting there', align: 'right' },
          { key: 'entered', label: 'Arrived this period', align: 'right' },
          { key: 'opportunities', label: 'Open opportunities', align: 'right' },
          { key: 'value', label: 'Open value', align: 'right' },
        ],
        rows: stages.map((s) => ({
          stage: s.name,
          open: s.open,
          entered: s.entered,
          opportunities: valueBy.get(s.stageId)?._count._all ?? 0,
          value: money(valueBy.get(s.stageId)?._sum.amount ?? null),
        })),
      };
    }

    case 'activity-log': {
      const where = (span: Within) => ({ tenantId, occurredAt: span, ...owned(userIds) });
      const rows =
        pivot === 'month'
          ? await perMonth(ctx, range, async (span, month) =>
              (await prismaRead.activity.groupBy({ by: ['typeId'], where: where(span), _count: { _all: true } })).map(
                (r) => ({ typeId: r.typeId, key: month as string | null, count: r._count._all }),
              ),
            )
          : (
              await prismaRead.activity.groupBy({
                by: ['typeId', 'ownerId'],
                where: where(within),
                _count: { _all: true },
              })
            ).map((r) => ({ typeId: r.typeId, key: r.ownerId, count: r._count._all }));
      const [types, label] = await Promise.all([
        prismaRead.activityType.findMany({
          where: { tenantId, id: { in: [...new Set(rows.map((r) => r.typeId))] } },
          select: { id: true, name: true },
        }),
        pivotLabels(
          tenantId,
          pivot,
          rows.map((r) => r.key),
        ),
      ]);
      const typeBy = new Map(types.map((t) => [t.id, t.name]));
      const column = pivot === 'month' ? 'month' : 'who';
      return {
        key,
        title: 'Activity log',
        columns: [
          { key: 'type', label: 'Type' },
          pivot === 'month' ? PIVOT_COLUMN.month : { key: 'who', label: 'Who' },
          { key: 'count', label: 'Logged', align: 'right' },
        ],
        rows: rows
          .map((r) => ({ type: typeBy.get(r.typeId) ?? r.typeId, [column]: label(r.key), count: r.count }))
          .sort((a, b) => pivotOrder(pivot, 'count')(a, b) || Number(b.count) - Number(a.count)),
      };
    }

    case 'revenue-forecast': {
      const opps = await prismaRead.opportunity.findMany({
        where: {
          tenantId,
          deletedAt: null,
          status: 'OPEN',
          expectedCloseDate: { not: null },
          ...owned(userIds),
        },
        select: { amount: true, probability: true, expectedCloseDate: true, currency: true },
      });

      const byMonth = new Map<string, { open: Prisma.Decimal; weighted: Prisma.Decimal; count: number }>();
      for (const o of opps) {
        const month = o.expectedCloseDate!.toISOString().slice(0, 7);
        const entry = byMonth.get(month) ?? {
          open: new Prisma.Decimal(0),
          weighted: new Prisma.Decimal(0),
          count: 0,
        };
        entry.open = entry.open.plus(o.amount);
        // Weighted by the probability already on the record. This forecasts
        // nothing of its own — inventing a curve here would be a second answer
        // to a question the pipeline already has one for.
        entry.weighted = entry.weighted.plus(o.amount.times(o.probability).dividedBy(100));
        entry.count += 1;
        byMonth.set(month, entry);
      }

      return {
        key,
        title: 'Revenue forecast',
        columns: [
          { key: 'month', label: 'Expected close' },
          { key: 'count', label: 'Opportunities', align: 'right' },
          { key: 'open', label: 'Open value', align: 'right' },
          { key: 'weighted', label: 'Weighted', align: 'right' },
        ],
        rows: [...byMonth.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([month, v]) => ({
            month,
            count: v.count,
            open: money(v.open),
            weighted: money(v.weighted),
          })),
        note: 'Open opportunities with an expected close date only, weighted by the probability on each record.',
      };
    }

    case 'team-performance': {
      const [revenue, bookings, leads, activities] = await Promise.all([
        rank(tenantId, userIds, range, 'revenue'),
        rank(tenantId, userIds, range, 'bookings'),
        rank(tenantId, userIds, range, 'leads'),
        rank(tenantId, userIds, range, 'activities'),
      ]);
      const ids = [...new Set([...revenue, ...bookings, ...leads, ...activities].map((r) => r.userId))];
      const who = await names(tenantId, ids);
      const lookup = (rows: { userId: string; value: number }[], id: string) =>
        rows.find((r) => r.userId === id)?.value ?? 0;

      return {
        key,
        title: 'Team performance',
        columns: [
          { key: 'who', label: 'Who' },
          { key: 'leads', label: 'Leads taken', align: 'right' },
          { key: 'activities', label: 'Activities', align: 'right' },
          { key: 'bookings', label: 'Bookings', align: 'right' },
          { key: 'revenue', label: 'Sale value', align: 'right' },
        ],
        rows: ids
          .map((id) => ({
            who: who.get(id) ?? id,
            leads: lookup(leads, id),
            activities: lookup(activities, id),
            bookings: lookup(bookings, id),
            revenue: lookup(revenue, id),
          }))
          .sort((a, b) => Number(b.revenue) - Number(a.revenue)),
      };
    }

    case 'rep-activity': {
      const [activities, response] = await Promise.all([
        rank(tenantId, userIds, range, 'activities'),
        prismaRead.lead.groupBy({
          by: ['ownerId'],
          where: { tenantId, deletedAt: null, createdAt: within, firstResponseMins: { not: null }, ...owned(userIds) },
          _avg: { firstResponseMins: true },
          _count: { _all: true },
        }),
      ]);
      const ids = [...new Set([...activities.map((a) => a.userId), ...response.map((r) => r.ownerId)])];
      const who = await names(tenantId, ids);

      return {
        key,
        title: 'Rep activity summary',
        columns: [
          { key: 'who', label: 'Who' },
          { key: 'activities', label: 'Activities', align: 'right' },
          { key: 'responded', label: 'Leads responded to', align: 'right' },
          { key: 'avgMins', label: 'Average first response', align: 'right' },
        ],
        rows: ids
          .filter((id): id is string => id !== null)
          .map((id) => {
            const r = response.find((x) => x.ownerId === id);
            const avg = r?._avg.firstResponseMins;
            return {
              who: who.get(id) ?? id,
              activities: activities.find((a) => a.userId === id)?.value ?? 0,
              responded: r?._count._all ?? 0,
              avgMins: avg === null || avg === undefined ? null : `${Math.round(avg)} min`,
            };
          })
          .sort((a, b) => Number(b.activities) - Number(a.activities)),
      };
    }

    case 'lead-assignment': {
      const rows = await prismaRead.leadAssignmentHistory.groupBy({
        by: ['toOwnerId', 'method'],
        where: { tenantId, createdAt: within, ...(userIds.length === 0 ? {} : { toOwnerId: { in: userIds } }) },
        _count: { _all: true },
      });
      const who = await names(
        tenantId,
        rows.map((r) => r.toOwnerId),
      );
      return {
        key,
        title: 'Lead assignment',
        columns: [
          { key: 'who', label: 'Assigned to' },
          { key: 'method', label: 'How' },
          { key: 'count', label: 'Leads', align: 'right' },
        ],
        rows: rows
          .map((r) => ({
            who: r.toOwnerId ? (who.get(r.toOwnerId) ?? r.toOwnerId) : 'Returned to the pool',
            method: (r.method ?? 'unrecorded').toString().replace(/_/g, ' ').toLowerCase(),
            count: r._count._all,
          }))
          .sort((a, b) => Number(b.count) - Number(a.count)),
      };
    }

    case 'campaign-performance': {
      const [byCampaign, converted] = await Promise.all([
        prismaRead.lead.groupBy({
          by: ['campaignId'],
          where: { tenantId, deletedAt: null, createdAt: within, ...owned(userIds) },
          _count: { _all: true },
          _avg: { score: true },
        }),
        prismaRead.lead.groupBy({
          by: ['campaignId'],
          where: {
            tenantId,
            deletedAt: null,
            createdAt: within,
            stage: { is: { category: 'CONVERSION' } },
            ...owned(userIds),
          },
          _count: { _all: true },
        }),
      ]);
      const campaigns = await prismaRead.campaign.findMany({
        where: { tenantId, id: { in: byCampaign.map((c) => c.campaignId).filter((c): c is string => c !== null) } },
        select: { id: true, name: true },
      });
      const nameBy = new Map(campaigns.map((c) => [c.id, c.name]));
      const convertedBy = new Map(converted.map((c) => [c.campaignId, c._count._all]));

      return {
        key,
        title: 'Campaign performance',
        columns: [
          { key: 'campaign', label: 'Campaign' },
          { key: 'leads', label: 'Leads', align: 'right' },
          { key: 'converted', label: 'Converted', align: 'right' },
          { key: 'rate', label: 'Rate', align: 'right' },
          { key: 'score', label: 'Average score', align: 'right' },
        ],
        rows: byCampaign
          .map((c) => {
            const total = c._count._all;
            const won = convertedBy.get(c.campaignId) ?? 0;
            return {
              campaign: c.campaignId ? (nameBy.get(c.campaignId) ?? 'Removed campaign') : 'No campaign',
              leads: total,
              converted: won,
              rate: total === 0 ? null : `${Math.round((won / total) * 1000) / 10}%`,
              score: c._avg.score === null ? null : Math.round(c._avg.score),
            };
          })
          .sort((a, b) => Number(b.leads) - Number(a.leads)),
      };
    }

    case 'follow-up-adherence': {
      // Ported from Lead Eagle's report of the same name: are we doing what we
      // said we would, when we said it?
      const now = new Date();
      const due = await prismaRead.followUpTask.findMany({
        where: { tenantId, deletedAt: null, status: { not: 'CANCELLED' }, dueAt: within, ...owned(userIds) },
        select: { ownerId: true, dueAt: true, status: true, completedAt: true },
      });
      const zone = pivot === 'month' ? await workspaceTimezone(ctx) : null;
      const keyOf = (f: (typeof due)[number]) => (zone ? todayKey(zone, f.dueAt).slice(0, 7) : f.ownerId);
      const label = await pivotLabels(tenantId, pivot, due.map(keyOf));
      const by = new Map<string, { due: number; done: number; onTime: number; overdue: number }>();
      for (const f of due) {
        const row = by.get(keyOf(f)) ?? { due: 0, done: 0, onTime: 0, overdue: 0 };
        row.due += 1;
        if (f.status === 'COMPLETED') {
          row.done += 1;
          if (f.completedAt && f.completedAt <= f.dueAt) row.onTime += 1;
        } else if (f.dueAt < now) row.overdue += 1;
        by.set(keyOf(f), row);
      }
      const column = PIVOT_COLUMN[pivot];
      return {
        key,
        title: 'Follow-up adherence',
        columns: [
          column,
          { key: 'due', label: 'Due', align: 'right' },
          { key: 'done', label: 'Done', align: 'right' },
          { key: 'onTime', label: 'On time', align: 'right' },
          { key: 'late', label: 'Late', align: 'right' },
          { key: 'overdue', label: 'Still overdue', align: 'right' },
          { key: 'rate', label: 'On-time rate', align: 'right' },
        ],
        rows: [...by]
          .map(([group, r]) => ({
            [column.key]: label(group),
            due: r.due,
            done: r.done,
            onTime: r.onTime,
            late: r.done - r.onTime,
            overdue: r.overdue,
            rate: pct(Math.round((r.onTime / r.due) * 100)),
          }))
          .sort((a, b) =>
            pivot === 'month' ? pivotOrder(pivot, 'due')(a, b) : b.overdue - a.overdue || b.due - a.due,
          ),
        note: 'On time is done no later than due. A follow-up due later in the period is neither late nor overdue yet, but counts in Due.',
      };
    }
    case 'source-to-booking': {
      const leads = await prismaRead.lead.findMany({
        where: { tenantId, deletedAt: null, createdAt: within, ...owned(userIds) },
        select: { id: true, source: true, sourceDetail: true, leadSource: LEAD_SOURCE },
      });
      // ponytail: the period's lead ids as one IN list; a join in SQL if a range ever holds 100k leads.
      const leadId = { in: leads.map((l) => l.id) };
      const [visited, booked] = await Promise.all([
        prismaRead.siteVisit.findMany({
          where: { tenantId, status: { in: [...VISITED] }, leadId },
          select: { leadId: true },
          distinct: ['leadId'],
        }),
        prismaRead.booking.findMany({
          where: { tenantId, deletedAt: null, status: { not: 'CANCELLED' }, leadId },
          select: { leadId: true, saleValue: true },
        }),
      ]);
      const sourceOf = new Map(leads.map((l) => [l.id, catalogueLabel(l)]));
      const by = new Map<string, { leads: number; visited: number; bookings: number; value: Prisma.Decimal }>();
      const row = (source: string) => {
        const r = by.get(source) ?? { leads: 0, visited: 0, bookings: 0, value: new Prisma.Decimal(0) };
        by.set(source, r);
        return r;
      };
      for (const l of leads) row(sourceOf.get(l.id)!).leads += 1;
      for (const v of visited) if (v.leadId && sourceOf.has(v.leadId)) row(sourceOf.get(v.leadId)!).visited += 1;
      for (const b of booked) {
        if (!b.leadId || !sourceOf.has(b.leadId)) continue;
        const r = row(sourceOf.get(b.leadId)!);
        r.bookings += 1;
        r.value = r.value.plus(b.saleValue);
      }
      return {
        key,
        title: 'Source to booking',
        columns: [
          { key: 'source', label: 'Source' },
          { key: 'leads', label: 'Leads', align: 'right' },
          { key: 'visited', label: 'Visited a property', align: 'right' },
          { key: 'bookings', label: 'Bookings', align: 'right' },
          { key: 'value', label: 'Booked value', align: 'right' },
          { key: 'rate', label: 'Lead to booking', align: 'right' },
        ],
        rows: [...by]
          .map(([source, r]) => ({
            source,
            leads: r.leads,
            visited: r.visited,
            bookings: r.bookings,
            value: money(r.value),
            rate: pct(Math.round((r.bookings / r.leads) * 100)),
          }))
          .sort((a, b) => b.bookings - a.bookings || b.leads - a.leads),
        note: 'Leads that arrived in the period, followed to their site visits and bookings whenever those happened. Cancelled bookings are left out.',
      };
    }

    case 'project-report': {
      // Ported in shape from Lead Eagle's projects report (M16-03). Inventory is the
      // workspace's, as it stands; leads, visits and bookings are the viewer's, in the period.
      const [projects, units] = await Promise.all([
        prismaRead.project.findMany({ where: { tenantId }, select: { id: true, name: true } }),
        prismaRead.unitInventory.groupBy({ by: ['projectId', 'status'], where: { tenantId }, _count: { _all: true } }),
      ]);
      const [interests, visits, bookings] = await Promise.all([
        prismaRead.leadProject.findMany({
          where: {
            tenantId,
            createdAt: within,
            ...(userIds.length === 0 ? {} : { lead: { is: { ownerId: { in: userIds } } } }),
          },
          select: { projectId: true, leadId: true },
        }),
        prismaRead.siteVisit.findMany({
          where: { tenantId, scheduledAt: within, projectId: { not: null }, leadId: { not: null }, ...owned(userIds) },
          select: { projectId: true, leadId: true, status: true },
        }),
        prismaRead.booking.groupBy({
          by: ['projectId'],
          where: { tenantId, deletedAt: null, status: { not: 'CANCELLED' }, bookingDate: within, ...owned(userIds) },
          _count: { _all: true },
          _sum: { saleValue: true },
        }),
      ]);
      const unitsOf = (id: string, status?: string) =>
        units
          .filter((u) => u.projectId === id && (!status || u.status === status))
          .reduce((n, u) => n + u._count._all, 0);
      const leadsOf = (id: string, visitedOnly: boolean) =>
        new Set([
          ...(visitedOnly ? [] : interests.filter((i) => i.projectId === id).map((i) => i.leadId)),
          ...visits
            .filter((v) => v.projectId === id && (!visitedOnly || (VISITED as readonly string[]).includes(v.status)))
            .map((v) => v.leadId),
        ]).size;
      const bookedBy = new Map(bookings.map((b) => [b.projectId, b]));
      return {
        key,
        title: 'Projects',
        columns: [
          { key: 'project', label: 'Project' },
          { key: 'units', label: 'Units', align: 'right' },
          { key: 'available', label: 'Available', align: 'right' },
          { key: 'booked', label: 'Booked', align: 'right' },
          { key: 'leads', label: 'Leads', align: 'right' },
          { key: 'visited', label: 'Visited', align: 'right' },
          { key: 'bookings', label: 'Bookings', align: 'right' },
          { key: 'value', label: 'Booked value', align: 'right' },
        ],
        rows: projects
          .map((p) => ({
            project: p.name,
            units: unitsOf(p.id),
            available: unitsOf(p.id, 'AVAILABLE'),
            booked: unitsOf(p.id, 'BOOKED'),
            leads: leadsOf(p.id, false),
            visited: leadsOf(p.id, true),
            bookings: bookedBy.get(p.id)?._count._all ?? 0,
            value: money(bookedBy.get(p.id)?._sum.saleValue ?? null),
          }))
          .sort((a, b) => b.leads - a.leads || b.bookings - a.bookings || a.project.localeCompare(b.project)),
        note: 'Units as they stand today. Leads asked about the project or were taken to it in the period; visited means the visit took place. Cancelled bookings are left out.',
      };
    }

    case 'site-visits': {
      // M16-07: scheduled is every visit not cancelled or refused; the show rate is done of done-or-missed.
      const where = (span: Within) => ({ tenantId, scheduledAt: span, ...owned(userIds) });
      const groups =
        pivot === 'month'
          ? await perMonth(ctx, range, async (span, month) =>
              (await prismaRead.siteVisit.groupBy({ by: ['status'], where: where(span), _count: { _all: true } })).map(
                (g) => ({ key: month as string | null, status: g.status, n: g._count._all }),
              ),
            )
          : pivot === 'project'
            ? (
                await prismaRead.siteVisit.groupBy({
                  by: ['projectId', 'status'],
                  where: where(within),
                  _count: { _all: true },
                })
              ).map((g) => ({ key: g.projectId, status: g.status, n: g._count._all }))
            : (
                await prismaRead.siteVisit.groupBy({
                  by: ['ownerId', 'status'],
                  where: where(within),
                  _count: { _all: true },
                })
              ).map((g) => ({ key: g.ownerId as string | null, status: g.status, n: g._count._all }));
      const tally = new Map<string | null, { scheduled: number; done: number; missed: number; cancelled: number }>();
      for (const g of groups) {
        const t = tally.get(g.key) ?? { scheduled: 0, done: 0, missed: 0, cancelled: 0 };
        tally.set(g.key, t);
        if (g.status === 'CANCELLED' || g.status === 'REJECTED') t.cancelled += g.n;
        else {
          t.scheduled += g.n;
          if (g.status === 'COMPLETED') t.done += g.n;
          if (g.status === 'NO_SHOW') t.missed += g.n;
        }
      }
      const label = await pivotLabels(tenantId, pivot, [...tally.keys()]);
      const column = PIVOT_COLUMN[pivot];
      return {
        key,
        title: 'Site visits',
        columns: [
          column,
          { key: 'scheduled', label: 'Scheduled', align: 'right' },
          { key: 'done', label: 'Done', align: 'right' },
          { key: 'missed', label: 'Missed', align: 'right' },
          { key: 'cancelled', label: 'Cancelled', align: 'right' },
          { key: 'rate', label: 'Show rate', align: 'right' },
        ],
        rows: [...tally]
          .map(([group, t]) => ({
            [column.key]: label(group),
            ...t,
            rate: t.done + t.missed === 0 ? null : pct(Math.round((t.done / (t.done + t.missed)) * 100)),
          }))
          .sort(pivotOrder(pivot, 'scheduled')),
        note: 'By the time each visit was booked for. Done is completed, missed is a no-show; cancelled and refused visits are not scheduled.',
      };
    }

    case 'call-report': {
      // M16-09: calls placed through the provider and calls logged by hand, as the board counts them.
      const placed = (span: Within) => ({
        tenantId,
        ...callTab('placed').where,
        createdAt: span,
        ...(userIds.length === 0 ? {} : { callerId: { in: userIds } }),
      });
      const logged = (span: Within) => ({ tenantId, ...LOGGED_CALL, occurredAt: span, ...owned(userIds) });
      type Group = { key: string | null; n: number; connected: boolean; secs: number | null };
      const read = async (span: Within, month?: string): Promise<Group[]> => {
        const sums = { _count: { _all: true }, _sum: { durationSecs: true } } as const;
        const [calls, logs] = await Promise.all([
          pivot === 'lead'
            ? prismaRead.call
                .groupBy({ by: ['leadId', 'status', 'outcome'], where: placed(span), ...sums })
                .then((r) => r.map((g) => ({ ...g, key: g.leadId })))
            : prismaRead.call
                .groupBy({ by: ['callerId', 'status', 'outcome'], where: placed(span), ...sums })
                .then((r) => r.map((g) => ({ ...g, key: month ?? (g.callerId as string | null) }))),
          pivot === 'lead'
            ? prismaRead.activity
                .groupBy({ by: ['leadId', 'outcome'], where: logged(span), ...sums })
                .then((r) => r.map((g) => ({ ...g, key: g.leadId })))
            : prismaRead.activity
                .groupBy({ by: ['ownerId', 'outcome'], where: logged(span), ...sums })
                .then((r) => r.map((g) => ({ ...g, key: month ?? g.ownerId }))),
        ]);
        return [
          ...calls.map((g) => ({
            key: g.key,
            n: g._count._all,
            connected: g.status === 'COMPLETED' && !!g.outcome && CONNECTED_CALL_OUTCOMES.includes(g.outcome),
            secs: g._sum.durationSecs,
          })),
          ...logs.map((g) => ({
            key: g.key,
            n: g._count._all,
            connected: !!g.outcome && CONNECTED_LOG_OUTCOMES.includes(g.outcome),
            secs: g._sum.durationSecs,
          })),
        ];
      };
      const groups = pivot === 'month' ? await perMonth(ctx, range, read) : await read(within);
      const tally = new Map<string | null, { calls: number; connected: number; secs: number }>();
      for (const g of groups) {
        const t = tally.get(g.key) ?? { calls: 0, connected: 0, secs: 0 };
        tally.set(g.key, t);
        t.calls += g.n;
        if (g.connected) t.connected += g.n;
        t.secs += g.secs ?? 0;
      }
      const label = await pivotLabels(tenantId, pivot, [...tally.keys()]);
      const column = PIVOT_COLUMN[pivot];
      return {
        key,
        title: 'Call report',
        columns: [
          column,
          { key: 'calls', label: 'Calls', align: 'right' },
          { key: 'connected', label: 'Connected', align: 'right' },
          { key: 'minutes', label: 'Talk time (min)', align: 'right' },
        ],
        rows: [...tally]
          .map(([group, t]) => ({
            [column.key]: label(group),
            calls: t.calls,
            connected: t.connected,
            minutes: Math.round(t.secs / 6) / 10,
          }))
          .sort(pivotOrder(pivot, 'calls')),
        note: 'Calls placed (not merely scheduled) and calls logged by hand. Connected means someone answered; talk time is what the provider or the agent recorded.',
      };
    }
    case 'source-analysis':
    case 'lead-quality': {
      // Grouped by the catalogue entry where a lead has one, else its enum (M4-03).
      const [grouped, convertedRows, entries] = await Promise.all([
        prismaRead.lead.groupBy({
          by: ['source', 'sourceId'],
          where: { tenantId, deletedAt: null, createdAt: within, ...owned(userIds) },
          // Sums and counts, not means: two groups that share a label add up exactly,
          // and a lead not yet answered (firstResponseMins null) counts in neither.
          _count: { _all: true, firstResponseMins: true },
          _sum: { score: true, firstResponseMins: true },
        }),
        prismaRead.lead.groupBy({
          by: ['source', 'sourceId'],
          where: {
            tenantId,
            deletedAt: null,
            createdAt: within,
            stage: { is: { category: 'CONVERSION' } },
            ...owned(userIds),
          },
          _count: { _all: true },
        }),
        prismaRead.leadSource.findMany({ where: { tenantId }, select: { id: true, ...LEAD_SOURCE.select } }),
      ]);
      const entry = new Map(entries.map((e) => [e.id, e]));
      const labelOf = (row: { source: string; sourceId: string | null }) =>
        leadSourceLabel(row.sourceId ? entry.get(row.sourceId) : null, ' / ') ??
        row.source.toString().replace(/_/g, ' ').toLowerCase();
      // Two entries can share a label only when one is the enum's: fold them together.
      const bySource = new Map<
        string,
        { source: string; leads: number; score: number; answered: number; minutes: number }
      >();
      for (const row of grouped) {
        const source = labelOf(row);
        const prior = bySource.get(source) ?? { source, leads: 0, score: 0, answered: 0, minutes: 0 };
        bySource.set(source, {
          source,
          leads: prior.leads + row._count._all,
          score: prior.score + (row._sum.score ?? 0),
          answered: prior.answered + row._count.firstResponseMins,
          minutes: prior.minutes + (row._sum.firstResponseMins ?? 0),
        });
      }
      const convertedBy = new Map<string, number>();
      for (const row of convertedRows) {
        const source = labelOf(row);
        convertedBy.set(source, (convertedBy.get(source) ?? 0) + row._count._all);
      }

      // Two menu entries, one query. Volume and quality are the same grouping
      // asked two ways, and splitting them would be two chances to disagree
      // about what a source's conversion rate is.
      const quality = key === 'lead-quality';

      return {
        key,
        title: quality ? 'Lead quality by source' : 'Source analysis',
        columns: quality
          ? [
              { key: 'source', label: 'Source' },
              { key: 'score', label: 'Average score', align: 'right' },
              { key: 'rate', label: 'Conversion rate', align: 'right' },
              { key: 'response', label: 'Average first response', align: 'right' },
            ]
          : [
              { key: 'source', label: 'Source' },
              { key: 'leads', label: 'Leads', align: 'right' },
              { key: 'converted', label: 'Converted', align: 'right' },
              { key: 'rate', label: 'Conversion rate', align: 'right' },
            ],
        // Both shapes carry `leads` so the sort below has one thing to read,
        // and the column list decides which keys are actually shown.
        rows: [...bySource.values()]
          .map((s): Record<string, Cell> => {
            const total = s.leads;
            const won = convertedBy.get(s.source) ?? 0;
            const rate = total === 0 ? null : `${Math.round((won / total) * 1000) / 10}%`;
            return {
              source: s.source,
              leads: total,
              converted: won,
              rate,
              score: total === 0 ? null : Math.round(s.score / total),
              response: s.answered === 0 ? null : `${Math.round(s.minutes / s.answered)} min`,
            };
          })
          .sort((a, b) => Number(b.leads ?? 0) - Number(a.leads ?? 0)),
      };
    }
  }
}

/**
 * A report as a CSV body.
 *
 * Uses the shared cell encoder rather than a local one. The first version of
 * this function quoted only cells that looked like they needed it and did not
 * defend against the spreadsheet formula trick — a value beginning `=`, `+`,
 * `-` or `@` is executed when the file is opened, so a lead named
 * `=HYPERLINK("http://…")` becomes a phishing link inside your own export. The
 * lead export had that covered from the start; this now shares it.
 */
export function toCsv(report: Report): string {
  const columns: CsvColumn<Record<string, Cell>>[] = report.columns.map((c) => ({
    label: c.label,
    value: (row) => row[c.key] ?? null,
  }));
  return csvHeader(columns) + report.rows.map((row) => csvRow(columns, row)).join('');
}
