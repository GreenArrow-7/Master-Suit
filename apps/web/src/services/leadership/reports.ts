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
import { NotFound } from '@/lib/errors';
import { mergeWhere } from '@/lib/api/where';
import { conversion, funnel, names, rank, subtree, throughLead, type Range } from './rollups';
import type { Ctx } from '@/lib/security/rbac';
import { hasAnyModuleEntitlement, SALES_OR_REALTY } from '@/lib/security/entitlements';
import { callScope } from '@/lib/security/record-scope';
import { LEAD_SOURCES } from '@/lib/integrations/leadSources';
import {
  boardQuery,
  boardWhere,
  callTab,
  cleanBoardFilter,
  LOGGED_CALL,
  resolveBoardFilter,
  scopeBoardFilter,
  type BoardFilter,
} from '@/lib/leads/boardFilter';
import { CONNECTED_CALL_OUTCOMES, CONNECTED_LOG_OUTCOMES } from '@/lib/leads/callLog';
import { isDayKey } from '@/lib/leads/followUpDue';
import { leadSourceLabel } from '@/services/leads/leadSources';
import { NOTE_ACTIVITY } from '@/services/leads/touch';
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
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

/**
 * Opportunities, bookings' sale value and campaigns are Sales' and Real
 * Estate's records: a Lead-Eagle-only workspace has none, so it is not offered
 * these, and asking for one by URL answers 404 (M16-00).
 */
const MONEY_REPORTS: readonly ReportKey[] = ['revenue-forecast', 'team-performance', 'campaign-performance'];

/** The reports this workspace's plan has rows for, in menu order. */
export async function offeredReports(tenantId: string): Promise<ReportKey[]> {
  const money = await hasAnyModuleEntitlement(tenantId, SALES_OR_REALTY);
  return REPORT_KEYS.filter((key) => money || !MONEY_REPORTS.includes(key));
}

/** What narrows a report inside the viewer's reach (M16-01, M16-12): the board's person or team, source and project. */
export type ReportFilter = Pick<BoardFilter, 'owner' | 'team' | 'source' | 'project'>;

/**
 * A report's period and filters from its URL (M16-12): the board's own
 * parameters (`range`, `from` and `to`, `owner`, `team`, `source`, `project`;
 * lib/leads/boardFilter.ts), so the board, its lists and a report read one link
 * alike. A day is the workspace's whole day; an instant (a link from before) is
 * taken as it is; a lone `from` or `to` is that bound, the other the default.
 * With no period, the first of the month two months back to the end of today.
 * A person or team outside the viewer's reports reach, or a source or project
 * the workspace does not hold, is dropped. `query` is the link that
 * reproduces exactly this: the CSV's, the menu's.
 */
export async function reportParams(ctx: Ctx, raw: Record<string, unknown>, now = new Date()) {
  const zone = await workspaceTimezone(ctx);
  const filter = await scopeBoardFilter(ctx, cleanBoardFilter(raw), undefined, 'reports');
  const { span } = await resolveBoardFilter(ctx, { range: filter.range, from: filter.from, to: filter.to }, zone, now);
  // A bound the board's period does not carry: a lone day, or an instant.
  const given = (key: 'from' | 'to') => {
    const value = [raw[key]].flat()[0];
    if (typeof value !== 'string') return null;
    if (isDayKey(value)) return { at: dayBounds(value, zone)[key], text: value };
    return Number.isNaN(Date.parse(value)) ? null : { at: new Date(value), text: new Date(value).toISOString() };
  };
  const today = todayKey(zone, now);
  const firstOfMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 3, 1));
  const range = span
    ? { from: span.gte, to: span.lte }
    : {
        from: given('from')?.at ?? dayBounds(firstOfMonth.toISOString().slice(0, 10), zone).from,
        to: given('to')?.at ?? dayBounds(today, zone).to,
      };
  const query = new URLSearchParams(boardQuery(filter));
  if (!span) for (const key of ['from', 'to'] as const) if (given(key)) query.set(key, given(key)!.text);
  return { filter, range, zone, query: query.toString() };
}

/** No user has this id: a narrowing that keeps nobody must not read as `[]`, the whole workspace. */
const NOBODY = ['-'];

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

const aed = (amount: Prisma.Decimal | null, currency = 'AED') =>
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
/** The portal or intake a lead's detail names, or null. */
const portalOf = (source: string, detail: string | null) => {
  // A referral's detail is whoever referred it, typed by hand: never an intake key.
  const key = source === 'REFERRAL' ? '' : (detail?.split(':')[0] ?? '');
  return Object.hasOwn(SOURCE_DETAIL, key) ? SOURCE_DETAIL[key]! : null;
};
const sourceLabel = (source: string, detail: string | null) =>
  portalOf(source, detail) ??
  (source === 'API' ? source : source.charAt(0) + source.slice(1).toLowerCase().replace(/_/g, ' '));
/** The workspace's catalogue entry where the lead has one (M4-03), else the label above. */
const catalogueLabel = (lead: {
  source: string;
  sourceDetail: string | null;
  leadSource: Parameters<typeof leadSourceLabel>[0];
}) => leadSourceLabel(lead.leadSource, ' / ') ?? sourceLabel(lead.source, lead.sourceDetail);
const LEAD_SOURCE = { select: { name: true, parent: { select: { name: true } } } };

export async function runReport(ctx: Ctx, key: ReportKey, range: Range, filter: ReportFilter = {}): Promise<Report> {
  const tenantId = ctx.tenantId;
  const money = await hasAnyModuleEntitlement(tenantId, SALES_OR_REALTY);
  if (!money && MONEY_REPORTS.includes(key)) throw NotFound('Report');
  // A person or a team's members, kept inside the viewer's reach ([] is everyone).
  const reach = await subtree(ctx);
  // No period is asked of it, so the zone is never read.
  const { people } = await resolveBoardFilter(ctx, { owner: filter.owner, team: filter.team }, 'UTC');
  const kept = people && (reach.length === 0 ? people : people.filter((id) => reach.includes(id)));
  const userIds = !kept ? reach : kept.length > 0 ? kept : NOBODY;
  // Source and project, on the lead (`lead`) or through it (`viaLead`), as the board's lists read them.
  const lead = boardWhere(
    { filter: { source: filter.source, project: filter.project }, people: null, span: null },
    'lead',
    false,
  ) as Prisma.LeadWhereInput;
  const viaLead = throughLead(lead);
  const within = { gte: range.from, lte: range.to };

  switch (key) {
    case 'lead-conversion': {
      const c = await conversion(tenantId, userIds, range, lead);
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
          // Opportunities and bookings are Sales' and Real Estate's records (M16-00).
          ...(money
            ? [
                { step: 'Became an opportunity', count: c.opportunities, rate: pct(c.leadToOpportunity) },
                { step: 'Became a booking', count: c.bookings, rate: pct(c.leadToBooking) },
              ]
            : []),
        ],
        note: 'A rate with no leads behind it is blank rather than 0%.',
      };
    }

    case 'pipeline-summary': {
      // The status report (M16-01): leads per stage, a person's or a team's through the filter.
      const [stages, value] = await Promise.all([
        funnel(tenantId, userIds, range, lead),
        // Opportunities are Sales' and Real Estate's: none to read in a Lead-Eagle-only workspace.
        money
          ? prismaRead.opportunity.groupBy({
              by: ['stageId'],
              where: { tenantId, deletedAt: null, status: 'OPEN', ...owned(userIds), ...viaLead },
              _sum: { amount: true },
              _count: { _all: true },
            })
          : [],
      ]);
      const valueBy = new Map(value.map((v) => [v.stageId, v]));
      const columns: Column[] = [
        { key: 'stage', label: 'Stage' },
        { key: 'open', label: 'Leads sitting there', align: 'right' },
        { key: 'entered', label: 'Arrived this period', align: 'right' },
      ];
      if (money) {
        columns.push(
          { key: 'opportunities', label: 'Open opportunities', align: 'right' },
          { key: 'value', label: 'Open value', align: 'right' },
        );
      }
      return {
        key,
        title: 'Pipeline summary',
        columns,
        rows: stages.map((s) => ({
          stage: s.name,
          open: s.open,
          entered: s.entered,
          ...(money && {
            opportunities: valueBy.get(s.stageId)?._count._all ?? 0,
            value: aed(valueBy.get(s.stageId)?._sum.amount ?? null),
          }),
        })),
      };
    }

    case 'activity-log': {
      const rows = await prismaRead.activity.groupBy({
        by: ['typeId', 'ownerId'],
        where: { tenantId, occurredAt: within, ...owned(userIds), ...viaLead },
        _count: { _all: true },
      });
      const [types, who] = await Promise.all([
        prismaRead.activityType.findMany({
          where: { tenantId, id: { in: [...new Set(rows.map((r) => r.typeId))] } },
          select: { id: true, name: true },
        }),
        names(
          tenantId,
          rows.map((r) => r.ownerId),
        ),
      ]);
      const typeBy = new Map(types.map((t) => [t.id, t.name]));
      return {
        key,
        title: 'Activity log',
        columns: [
          { key: 'type', label: 'Type' },
          { key: 'who', label: 'Who' },
          { key: 'count', label: 'Logged', align: 'right' },
        ],
        rows: rows
          .map((r) => ({
            type: typeBy.get(r.typeId) ?? r.typeId,
            who: r.ownerId ? (who.get(r.ownerId) ?? r.ownerId) : 'Unassigned',
            count: r._count._all,
          }))
          .sort((a, b) => Number(b.count) - Number(a.count)),
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
          ...viaLead,
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
            open: aed(v.open),
            weighted: aed(v.weighted),
          })),
        note: 'Open opportunities with an expected close date only, weighted by the probability on each record.',
      };
    }

    case 'team-performance': {
      const [revenue, bookings, leads, activities] = await Promise.all([
        rank(tenantId, userIds, range, 'revenue', lead),
        rank(tenantId, userIds, range, 'bookings', lead),
        rank(tenantId, userIds, range, 'leads', lead),
        rank(tenantId, userIds, range, 'activities', lead),
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
      // Each agent's work (M16-05): activities, calls and how many got through, the
      // stage moves they made, their notes, and how fast they answered new leads.
      const person = (field: string) => (userIds.length === 0 ? {} : { [field]: { in: userIds } });
      // Two rounds of three: one render asks for half the connection pool at most.
      const [activities, response, placed] = await Promise.all([
        rank(tenantId, userIds, range, 'activities', lead),
        prismaRead.lead.groupBy({
          by: ['ownerId'],
          where: {
            tenantId,
            deletedAt: null,
            createdAt: within,
            firstResponseMins: { not: null },
            ...owned(userIds),
            ...lead,
          },
          _avg: { firstResponseMins: true },
          _count: { _all: true },
        }),
        // Calls through the provider, under the calls scope as every read of calls is.
        callScope(ctx, 'VIEW').then((scope) =>
          prismaRead.call.groupBy({
            by: ['callerId', 'status', 'outcome'],
            where: mergeWhere(scope, callTab('placed').where, person('callerId'), viaLead, {
              tenantId,
              deletedAt: null,
              createdAt: within,
            }) as Prisma.CallWhereInput,
            _count: { _all: true },
          }),
        ),
      ]);
      const [logged, moves, notes] = await Promise.all([
        // Calls logged by hand are activities, read as the Activities column is.
        prismaRead.activity.groupBy({
          by: ['ownerId', 'outcome'],
          where: { tenantId, occurredAt: within, ...LOGGED_CALL, ...owned(userIds), ...viaLead },
          _count: { _all: true },
        }),
        prismaRead.leadStageHistory.groupBy({
          by: ['changedById'],
          where: {
            tenantId,
            createdAt: within,
            // A lead's first stage is its creation (createLead, an import), not a move.
            fromStageId: { not: null },
            changedById: userIds.length === 0 ? { not: null } : { in: userIds },
            ...viaLead,
          },
          _count: { _all: true },
        }),
        prismaRead.activity.groupBy({
          by: ['ownerId'],
          // Notes they wrote and kept: not deleted ones, nor a spreadsheet's remarks, which an
          // import files as notes under the importer. ponytail: notes moved from the standalone
          // Lead Eagle are IMPORT too, so they drop out; mark the move's source if that history matters.
          where: {
            tenantId,
            occurredAt: within,
            deletedAt: null,
            source: { not: 'IMPORT' },
            type: { is: { key: NOTE_ACTIVITY } },
            ...owned(userIds),
            ...viaLead,
          },
          _count: { _all: true },
        }),
      ]);
      const calls = new Map<string, { calls: number; connected: number }>();
      const tally = (id: string | null, n: number, connected: boolean) => {
        if (!id) return;
        const row = calls.get(id) ?? { calls: 0, connected: 0 };
        row.calls += n;
        if (connected) row.connected += n;
        calls.set(id, row);
      };
      for (const r of placed) {
        const connected = r.status === 'COMPLETED' && !!r.outcome && CONNECTED_CALL_OUTCOMES.includes(r.outcome);
        tally(r.callerId, r._count._all, connected);
      }
      for (const r of logged)
        tally(r.ownerId, r._count._all, !!r.outcome && CONNECTED_LOG_OUTCOMES.includes(r.outcome));
      const movesBy = new Map(moves.map((m) => [m.changedById, m._count._all]));
      const notesBy = new Map(notes.map((n) => [n.ownerId, n._count._all]));
      const ids = [
        ...new Set([
          ...activities.map((a) => a.userId),
          ...response.map((r) => r.ownerId),
          ...calls.keys(),
          ...movesBy.keys(),
          ...notesBy.keys(),
        ]),
      ].filter((id): id is string => !!id);
      const who = await names(tenantId, ids);

      return {
        key,
        title: 'Rep activity summary',
        columns: [
          { key: 'who', label: 'Who' },
          { key: 'activities', label: 'Activities', align: 'right' },
          { key: 'calls', label: 'Calls', align: 'right' },
          { key: 'connected', label: 'Connected', align: 'right' },
          { key: 'moves', label: 'Stage moves', align: 'right' },
          { key: 'notes', label: 'Notes', align: 'right' },
          { key: 'responded', label: 'Leads responded to', align: 'right' },
          { key: 'avgMins', label: 'Average first response', align: 'right' },
        ],
        rows: ids
          .map((id) => {
            const r = response.find((x) => x.ownerId === id);
            const avg = r?._avg.firstResponseMins;
            return {
              who: who.get(id) ?? id,
              activities: activities.find((a) => a.userId === id)?.value ?? 0,
              calls: calls.get(id)?.calls ?? 0,
              connected: calls.get(id)?.connected ?? 0,
              moves: movesBy.get(id) ?? 0,
              notes: notesBy.get(id) ?? 0,
              responded: r?._count._all ?? 0,
              avgMins: avg === null || avg === undefined ? null : `${Math.round(avg)} min`,
            };
          })
          .sort((a, b) => b.activities - a.activities || b.calls - a.calls),
        note: 'Calls are those placed through the telephony provider and those logged by hand; connected is a call that reached the client. A stage move counts for whoever made it.',
      };
    }

    case 'lead-assignment': {
      const rows = await prismaRead.leadAssignmentHistory.groupBy({
        by: ['toOwnerId', 'method'],
        where: {
          tenantId,
          createdAt: within,
          ...(userIds.length === 0 ? {} : { toOwnerId: { in: userIds } }),
          ...viaLead,
        },
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
          where: { tenantId, deletedAt: null, createdAt: within, ...owned(userIds), ...lead },
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
            ...lead,
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
        where: {
          tenantId,
          deletedAt: null,
          status: { not: 'CANCELLED' },
          dueAt: within,
          ...owned(userIds),
          ...viaLead,
        },
        select: { ownerId: true, dueAt: true, status: true, completedAt: true },
      });
      const who = await names(
        tenantId,
        due.map((f) => f.ownerId),
      );
      const by = new Map<string, { due: number; done: number; onTime: number; overdue: number }>();
      for (const f of due) {
        const row = by.get(f.ownerId) ?? { due: 0, done: 0, onTime: 0, overdue: 0 };
        row.due += 1;
        if (f.status === 'COMPLETED') {
          row.done += 1;
          if (f.completedAt && f.completedAt <= f.dueAt) row.onTime += 1;
        } else if (f.dueAt < now) row.overdue += 1;
        by.set(f.ownerId, row);
      }
      return {
        key,
        title: 'Follow-up adherence',
        columns: [
          { key: 'agent', label: 'Agent' },
          { key: 'due', label: 'Due', align: 'right' },
          { key: 'done', label: 'Done', align: 'right' },
          { key: 'onTime', label: 'On time', align: 'right' },
          { key: 'late', label: 'Late', align: 'right' },
          { key: 'overdue', label: 'Still overdue', align: 'right' },
          { key: 'rate', label: 'On-time rate', align: 'right' },
        ],
        rows: [...by]
          .map(([ownerId, r]) => ({
            agent: who.get(ownerId) ?? 'Unknown',
            due: r.due,
            done: r.done,
            onTime: r.onTime,
            late: r.done - r.onTime,
            overdue: r.overdue,
            rate: pct(Math.round((r.onTime / r.due) * 100)),
          }))
          .sort((a, b) => b.overdue - a.overdue || b.due - a.due),
        note: 'On time is done no later than due. A follow-up due later in the period is neither late nor overdue yet, but counts in Due.',
      };
    }
    case 'source-to-booking': {
      const leads = await prismaRead.lead.findMany({
        where: { tenantId, deletedAt: null, createdAt: within, ...owned(userIds), ...lead },
        select: { id: true, source: true, sourceDetail: true, leadSource: LEAD_SOURCE },
      });
      // ponytail: the period's lead ids as one IN list; a join in SQL if a range ever holds 100k leads.
      const leadId = { in: leads.map((l) => l.id) };
      const [visited, booked] = await Promise.all([
        prismaRead.siteVisit.findMany({
          where: { tenantId, status: { in: ['CHECKED_IN', 'COMPLETED'] }, leadId },
          select: { leadId: true },
          distinct: ['leadId'],
        }),
        // Bookings are Sales' and Real Estate's: none to read in a Lead-Eagle-only workspace (M16-00).
        money
          ? prismaRead.booking.findMany({
              where: { tenantId, deletedAt: null, status: { not: 'CANCELLED' }, leadId },
              select: { leadId: true, saleValue: true },
            })
          : [],
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
          ...(money
            ? ([
                { key: 'bookings', label: 'Bookings', align: 'right' },
                { key: 'value', label: 'Booked value', align: 'right' },
                { key: 'rate', label: 'Lead to booking', align: 'right' },
              ] satisfies Column[])
            : []),
        ],
        rows: [...by]
          .map(([source, r]) => ({
            source,
            leads: r.leads,
            visited: r.visited,
            bookings: r.bookings,
            value: aed(r.value),
            rate: pct(Math.round((r.bookings / r.leads) * 100)),
          }))
          .sort((a, b) => b.bookings - a.bookings || b.leads - a.leads),
        note: money
          ? 'Leads that arrived in the period, followed to their site visits and bookings whenever those happened. Cancelled bookings are left out.'
          : 'Leads that arrived in the period, followed to their site visits whenever those happened.',
      };
    }
    case 'source-analysis':
    case 'lead-quality': {
      // By the catalogue entry where a lead has one (M4-03); else by the portal its
      // intake named (`bayut:…`), which folds it into that portal's entry (M16-02);
      // else by its pipeline source.
      // ponytail: the period's leads in memory, as Source to Booking reads them; a GROUP BY on the label at 100k leads.
      const leads = await prismaRead.lead.findMany({
        where: { tenantId, deletedAt: null, createdAt: within, ...owned(userIds), ...lead },
        select: {
          source: true,
          sourceDetail: true,
          score: true,
          firstResponseMins: true,
          leadSource: LEAD_SOURCE,
          stage: { select: { category: true } },
        },
      });
      // Sums and counts, not means: two groups that share a label add up exactly,
      // and a lead not yet answered (firstResponseMins null) counts in neither.
      const bySource = new Map<
        string,
        { source: string; leads: number; won: number; score: number; answered: number; minutes: number }
      >();
      for (const l of leads) {
        const source =
          leadSourceLabel(l.leadSource, ' / ') ??
          portalOf(l.source, l.sourceDetail) ??
          l.source.replace(/_/g, ' ').toLowerCase();
        const row = bySource.get(source) ?? { source, leads: 0, won: 0, score: 0, answered: 0, minutes: 0 };
        row.leads += 1;
        if (l.stage?.category === 'CONVERSION') row.won += 1;
        row.score += l.score ?? 0;
        if (l.firstResponseMins !== null) {
          row.answered += 1;
          row.minutes += l.firstResponseMins;
        }
        bySource.set(source, row);
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
            const won = s.won;
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
