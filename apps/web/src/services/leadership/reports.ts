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
import { prisma } from '@/lib/db';
import { csvHeader, csvRow, type CsvColumn } from '@/lib/csv';
import { conversion, funnel, rank, subtree, type Range } from './rollups';
import type { Ctx } from '@/lib/security/rbac';

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
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

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

async function names(tenantId: string, ids: (string | null)[]) {
  const real = [...new Set(ids.filter((i): i is string => i !== null))];
  if (real.length === 0) return new Map<string, string>();
  const rows = await prisma.user.findMany({
    where: { tenantId, id: { in: real } },
    select: { id: true, fullName: true },
  });
  return new Map(rows.map((u) => [u.id, u.fullName]));
}

export async function runReport(ctx: Ctx, key: ReportKey, range: Range): Promise<Report> {
  const tenantId = ctx.tenantId;
  const userIds = await subtree(ctx);
  const within = { gte: range.from, lte: range.to };

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
        prisma.opportunity.groupBy({
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
      const rows = await prisma.activity.groupBy({
        by: ['typeId', 'ownerId'],
        where: { tenantId, occurredAt: within, ...owned(userIds) },
        _count: { _all: true },
      });
      const [types, who] = await Promise.all([
        prisma.activityType.findMany({
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
      const opps = await prisma.opportunity.findMany({
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
        prisma.lead.groupBy({
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
      const rows = await prisma.leadAssignmentHistory.groupBy({
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
        prisma.lead.groupBy({
          by: ['campaignId'],
          where: { tenantId, deletedAt: null, createdAt: within, ...owned(userIds) },
          _count: { _all: true },
          _avg: { score: true },
        }),
        prisma.lead.groupBy({
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
      const campaigns = await prisma.campaign.findMany({
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

    case 'source-analysis':
    case 'lead-quality': {
      const [bySource, converted] = await Promise.all([
        prisma.lead.groupBy({
          by: ['source'],
          where: { tenantId, deletedAt: null, createdAt: within, ...owned(userIds) },
          _count: { _all: true },
          _avg: { score: true, firstResponseMins: true },
        }),
        prisma.lead.groupBy({
          by: ['source'],
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
      const convertedBy = new Map(converted.map((c) => [c.source, c._count._all]));

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
        rows: bySource
          .map((s): Record<string, Cell> => {
            const total = s._count._all;
            const won = convertedBy.get(s.source) ?? 0;
            const rate = total === 0 ? null : `${Math.round((won / total) * 1000) / 10}%`;
            return {
              source: s.source.toString().replace(/_/g, ' ').toLowerCase(),
              leads: total,
              converted: won,
              rate,
              score: s._avg.score === null ? null : Math.round(s._avg.score),
              response: s._avg.firstResponseMins === null ? null : `${Math.round(s._avg.firstResponseMins)} min`,
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
