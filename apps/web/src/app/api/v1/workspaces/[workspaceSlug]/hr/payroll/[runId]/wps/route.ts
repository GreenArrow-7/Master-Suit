import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { requireWorkspace } from '@/lib/workspace';
import { generateSif, type SifLayoutKey } from '@/services/hr/wps';

/**
 * The WPS salary file for one payroll run.
 *
 * Its own route rather than an action, because the response is a file rather
 * than JSON, and because `payroll:EXPORT` is a distinct authority from approving
 * a run — the person who signs the payroll off is not necessarily the person who
 * transmits it to the bank.
 *
 * Employees the file cannot carry (no IBAN, no labour-card identifier) are
 * reported in a response header rather than silently dropped: a short file that
 * looks successful is how somebody does not get paid.
 *
 * It bulk-exports every employee's IBAN and labour-card number, and once had no
 * rate limit at all; the kernel's per-session limit cannot be left out.
 */
export const GET = route(
  {
    module: 'payroll',
    action: 'EXPORT',
    productModule: 'HRMS',
    sessionOnly: true,
    params: z.object({ workspaceSlug: z.string(), runId: z.string() }),
  },
  async ({ ctx, params, req }) => {
    await requireWorkspace(ctx, params.workspaceSlug);
    const layout = (new URL(req.url).searchParams.get('layout') ?? 'uae-sif-v1') as SifLayoutKey;
    const file = await generateSif(ctx, params.runId, layout);

    return new NextResponse(file.content, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${file.filename.replace(/"/g, '')}"`,
        'cache-control': 'private, no-store',
        'x-wps-included': String(file.included),
        'x-wps-excluded': String(file.excluded.length),
      },
    });
  },
);
