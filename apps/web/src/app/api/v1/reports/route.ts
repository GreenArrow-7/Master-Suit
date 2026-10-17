import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { audit } from '@/lib/security/audit';
import { assertPermission } from '@/lib/security/rbac';
import { BOARD_RANGES, type BoardRange } from '@/lib/leads/boardFilter';
import { isDayKey } from '@/lib/leads/followUpDue';
import { reportParams, runReport, toCsv, REPORT_KEYS } from '@/services/leadership/reports';
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
    format: z.enum(['json', 'csv']).default('json'),
  })
  .strict()
  .refine((v) => !v.from || !v.to || Date.parse(v.to) >= Date.parse(v.from), {
    path: ['to'],
    message: 'The range ends before it starts.',
  });

/**
 * A report, as JSON or as a file.
 *
 * §4 asks for every list to be exportable, and one `{ columns, rows }` shape
 * across all ten reports means that is one function rather than ten.
 *
 * The file needs EXPORT as well as VIEW, and is audited: several reports name
 * leads row by row, and a CSV is a copy that leaves the building.
 */
export const GET = route(
  { module: 'reports', productModule: LEAD_MODULES, action: 'VIEW', query },
  async ({ ctx, query: q }) => {
    if (q.format === 'csv') assertPermission(ctx, 'reports', 'EXPORT');
    const { range, filter, zone } = await reportParams(ctx, q);

    const report = await runReport(ctx, q.report, range, filter);
    if (q.format === 'json') return report;

    await audit(ctx, {
      event: 'EXPORT_REQUESTED',
      objectType: 'report',
      recordId: q.report,
      metadata: {
        report: q.report,
        ...filter,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        rows: report.rows.length,
      },
    });
    const stamp = todayKey(zone, range.to);
    return new Response(toCsv(report), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${q.report}-${stamp}.csv"`,
        // A report is somebody's live numbers; a cached copy in a shared proxy
        // is both stale and somebody else's data.
        'cache-control': 'no-store',
      },
    });
  },
);
