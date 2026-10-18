import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { audit } from '@/lib/security/audit';
import { assertPermission } from '@/lib/security/rbac';
import { BOARD_RANGES, type BoardRange } from '@/lib/leads/boardFilter';
import { isDayKey } from '@/lib/leads/followUpDue';
import {
  PIVOT_KEYS,
  PIVOTS,
  reportFileName,
  reportParams,
  runReport,
  toCsv,
  toXlsx,
  REPORT_FORMATS,
  REPORT_KEYS,
} from '@/services/leadership/reports';
import { XLSX_TYPE } from '@/lib/xlsx';
import { todayKey } from '@/services/targets/dailyBoard';

/** A day on the workspace's clock (YYYY-MM-DD), or an instant as links carried before. */
const when = z
  .string()
  .refine((v) => isDayKey(v) || !Number.isNaN(Date.parse(v)), 'A day (YYYY-MM-DD) or a date and time.');
const id = z.string().max(40).optional();

const query = z
  .object({
    report: z.enum(REPORT_KEYS),
    // The board's filters (M16-12): a period, a person or team, a source, a project.
    range: z.enum(Object.keys(BOARD_RANGES) as [BoardRange, ...BoardRange[]]).optional(),
    from: when.optional(),
    to: when.optional(),
    owner: id,
    team: id,
    source: id,
    project: id,
    // A regrouping (M16-13): what the rows are keyed by.
    by: z.enum(PIVOT_KEYS).optional(),
    // A file: the CSV, or the same rows as an Excel workbook (M16-15).
    format: z.enum(['json', ...REPORT_FORMATS]).default('json'),
  })
  .strict()
  .refine((v) => !v.from || !v.to || Date.parse(v.to) >= Date.parse(v.from), {
    path: ['to'],
    message: 'The range ends before it starts.',
  })
  .refine((v) => !v.by || (PIVOTS[v.report] ?? []).includes(v.by), {
    path: ['by'],
    message: 'This report cannot be grouped that way.',
  });

/**
 * A report, as JSON or as a file.
 *
 * §4 asks for every list to be exportable, and one `{ columns, rows }` shape
 * across all ten reports means that is one function rather than ten.
 *
 * The file (a CSV, or an Excel workbook of the same rows) needs EXPORT as well
 * as VIEW, and is audited: several reports name leads row by row, and a file
 * is a copy that leaves the building.
 */
export const GET = route(
  { module: 'reports', productModule: LEAD_MODULES, action: 'VIEW', query },
  async ({ ctx, query: q }) => {
    if (q.format !== 'json') assertPermission(ctx, 'reports', 'EXPORT');
    const { range, filter, zone } = await reportParams(ctx, q);

    const report = await runReport(ctx, q.report, range, { ...filter, by: q.by });
    if (q.format === 'json') return report;

    await audit(ctx, {
      event: 'EXPORT_REQUESTED',
      objectType: 'report',
      recordId: q.report,
      metadata: {
        report: q.report,
        ...filter,
        ...(q.by && { by: q.by }),
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        rows: report.rows.length,
        format: q.format,
      },
    });
    const stamp = todayKey(zone, range.to);
    const xlsx = q.format === 'xlsx';
    return new Response(xlsx ? await toXlsx(report) : toCsv(report), {
      headers: {
        'content-type': xlsx ? XLSX_TYPE : 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${reportFileName(q.report, q.by, stamp, q.format)}"`,
        // A report is somebody's live numbers; a cached copy in a shared proxy
        // is both stale and somebody else's data.
        'cache-control': 'no-store',
      },
    });
  },
);
