import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { runReport, toCsv, REPORT_KEYS } from '@/services/leadership/reports';

const query = z
  .object({
    report: z.enum(REPORT_KEYS),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.to >= v.from, {
    path: ['to'],
    message: 'The range ends before it starts.',
  });

/**
 * A report, as JSON or as a file.
 *
 * §4 asks for every list to be exportable, and one `{ columns, rows }` shape
 * across all ten reports means that is one function rather than ten.
 */
export const GET = route(
  { module: 'reports', productModule: 'SALES', action: 'VIEW', query },
  async ({ ctx, query: q }) => {
    const to = q.to ?? new Date();
    const from = q.from ?? new Date(to.getFullYear(), to.getMonth() - 2, 1);

    const report = await runReport(ctx, q.report, { from, to });
    if (q.format === 'json') return report;

    const stamp = to.toISOString().slice(0, 10);
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
