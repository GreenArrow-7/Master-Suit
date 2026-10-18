import { LEAD_MODULES } from '@/lib/security/entitlements';
import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { prismaRead } from '@/lib/db';
import { scopedNextFollowUp } from '@/services/leads/nextFollowUp';
import { leadListParams, leadListQuery } from '@/services/leads/leadList';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { audit } from '@/lib/security/audit';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import { resolveColumns, storedColumnsFor } from '@/lib/grid/columns';
import { customCells, customColumns } from '@/services/leads/customFields';
import { route } from '@/lib/api/handler';
import { XLSX_TYPE, onClock, xlsxStream } from '@/lib/xlsx';
import { parseTypedDate } from '@/lib/dates';
import { workspaceTimezone } from '@/services/hr/attendance';
import { z } from 'zod';

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

// The grid's own URL (filter, search, chips, sort, a saved view's columns),
// answered by the grid's own query, so the file is the list that was on screen.
// Two copies of that query had already drifted: this one was missing `mine`,
// then the follow-up filters and the phone search.
// `format=xlsx`: the same columns and rows as an Excel workbook (M16-15).
const query = leadListParams
  .omit({ layout: true })
  .extend({ format: z.enum(['csv', 'xlsx']).default('csv') })
  .strict();

/** RFC 4180: quote every field, double any embedded quote. Also blunts the
 *  spreadsheet formula-injection trick where a value starting =, +, - or @ is
 *  executed on open. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const GET = route(
  { module: 'leads', action: 'EXPORT', productModule: LEAD_MODULES, sessionOnly: true, query },
  async ({ ctx, query: { format, ...params } }) => {
    const [setting, rules, extra, zone] = await Promise.all([
      prismaRead.organizationSetting.findUnique({ where: { tenantId: ctx.tenantId }, select: { gridColumns: true } }),
      loadFieldRules(ctx, 'LEAD'),
      // The workspace's custom fields, as the grid offers them (`cf:<key>`, M18-03).
      customColumns(ctx.tenantId),
      format === 'xlsx' ? workspaceTimezone(ctx) : null,
    ]);
    /**
     * An export is an egress path, so it gets the same treatment as the screen.
     *
     * The CSV used to carry the stored column straight out of the database — the
     * one number in this package that aggregates every owner — which made a file
     * download the easiest way to read a colleague's schedule. Both the row filter
     * and the emitted date are the viewer's own derivation.
     */
    const { where, access } = await leadListQuery(ctx, params, rules);

    const columns = resolveColumns(
      'LEAD',
      params.cols?.split(',') ?? storedColumnsFor(setting?.gridColumns, 'LEAD'),
      extra,
    );
    // The workbook's dates are typed and on the workspace's clock, as the grid
    // shows them; the CSV keeps its UTC `Z` and a DATE field's DD/MM/YYYY.
    const days = new Set(columns.filter((column) => column.date).map((column) => column.key));
    const value = (row: Record<string, any>, key: string) => {
      if (key.startsWith('cf:')) {
        const day = row.customData?.[key.slice(3)];
        if (zone && days.has(key) && typeof day === 'string' && parseTypedDate(day) === day) return new Date(day);
        return customCells(columns, row.customData)[key];
      }
      switch (key) {
        case 'stage':
          return row.stage?.name;
        case 'owner':
          return row.owner?.fullName ?? 'Unassigned';
        default:
          return zone && row[key] instanceof Date ? onClock(row[key], zone) : row[key];
      }
    };

    // Streamed in keyset pages rather than gathered into one array, so memory is
    // bounded by page size rather than by the size of the result — no point in
    // this function holds the whole file.
    //
    // EXPORT_MAX_ROWS still caps it. Memory was never the only cost: an unbounded
    // export holds a replica connection and streams every lead in the workspace to
    // whoever asked, and "there is no row limit" is the shape of an exfiltration
    // rather than a feature. The setting has been declared in lib/env.ts and read
    // nowhere since it was added, so an operator who lowered it changed nothing.
    const PAGE = 500;
    const MAX_ROWS = env.EXPORT_MAX_ROWS;

    const leadPage = (cursor: string | null, take: number) =>
      prismaRead.lead.findMany({
        where,
        // By id whatever the grid's sort: the cursor walks a key no edit
        // changes, where an updatedAt walk would skip or repeat a lead edited
        // while the file streams.
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          reference: true,
          fullName: true,
          email: true,
          phone: true,
          company: true,
          score: true,
          grade: true,
          priority: true,
          slaState: true,
          nextFollowUpAt: true,
          updatedAt: true,
          ownerId: true,
          stage: { select: { key: true, name: true, color: true } },
          owner: { select: { fullName: true } },
          customData: true,
        },
      });

    /** The file's rows, a page at a time, each row its cells' values; audited after the last. */
    async function* pages() {
      let cursor: string | null = null;
      let exported = 0;
      for (;;) {
        // The last page is trimmed to land exactly on the cap rather than
        // overshooting it by up to PAGE-1 rows.
        const page = await leadPage(cursor, Math.min(PAGE, MAX_ROWS - exported));
        if (page.length === 0 || exported >= MAX_ROWS) break;

        // One derivation per page, not per row. Bounded by PAGE like the query it
        // follows, so a 50,000-row export is still two extra queries per page.
        const due = await scopedNextFollowUp(
          ctx.tenantId,
          page.map((r) => r.id),
          access,
        );

        // Masking runs on the export exactly as it does on the grid — an export must
        // not be a way around field-level security.
        yield page
          .map((row) => ({ ...row, nextFollowUpAt: due.get(row.id) ?? null }))
          .map((row) => applyFieldSecurity(ctx, 'LEAD', rules, row, LEAD_SENSITIVE_FIELDS) as Record<string, any>)
          .map((row) => columns.map((column) => value(row, column.key)));
        exported += page.length;
        cursor = page[page.length - 1].id;
      }

      // Audited on completion so the record reflects what actually left the
      // system — including `truncated`, because a caller who received a capped
      // file and a reviewer reading this row must both be able to tell that
      // the export is not the whole answer.
      // What was asked for, so a narrowed file reads as one; whether it was
      // searched, not what was typed (a phone number stays out of the trail).
      const { q, ...asked } = params;
      await audit(ctx, {
        event: 'EXPORT_REQUESTED',
        objectType: 'leads',
        metadata: {
          rows: exported,
          ...asked,
          filter: params.filter ?? null,
          searched: Boolean(q),
          truncated: exported >= MAX_ROWS,
          ...(exported >= MAX_ROWS ? { limit: MAX_ROWS } : {}),
          format,
        },
      });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const headers = (type: string) => ({
      'content-type': type,
      'content-disposition': `attachment; filename="leads-${stamp}.${format}"`,
      'cache-control': 'no-store',
    });
    const labels = columns.map((column) => column.label);
    if (format === 'xlsx')
      return new NextResponse(xlsxStream(labels, pages(), 'Leads'), { headers: headers(XLSX_TYPE) });

    const rows = pages();
    const encoder = new TextEncoder();
    const line = (cells: unknown[]) => cells.map(csvCell).join(',') + '\r\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('\ufeff' + line(labels)));
      },
      async pull(controller) {
        const page = await rows.next();
        if (page.done) controller.close();
        else controller.enqueue(encoder.encode(page.value.map(line).join('')));
      },
      async cancel() {
        await rows.return(undefined);
      },
    });
    return new NextResponse(stream, { headers: headers('text/csv; charset=utf-8') });
  },
);
