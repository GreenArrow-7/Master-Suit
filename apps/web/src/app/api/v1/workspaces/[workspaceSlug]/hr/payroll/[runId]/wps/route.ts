import { resolveGuardedCtx } from '@/lib/api/guarded';
import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
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
 */
export async function GET(req: Request, context: { params: Promise<{ workspaceSlug: string; runId: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const { workspaceSlug, runId } = await context.params;
    // This one had no rate limit at all, and it bulk-exports every employee's
    // IBAN and labour-card number. `resolveGuardedCtx` applies the per-session
    // bucket unless a route asks for another, so it cannot be omitted again.
    const ctx = await resolveGuardedCtx(req, requestId, {
      productModule: 'HRMS',
      permission: ['payroll', 'EXPORT'],
    });
    await requireWorkspace(ctx, workspaceSlug, 'HRMS');

    const layout = (new URL(req.url).searchParams.get('layout') ?? 'uae-sif-v1') as SifLayoutKey;
    const file = await generateSif(ctx, runId, layout);

    return new NextResponse(file.content, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${file.filename.replace(/"/g, '')}"`,
        'cache-control': 'private, no-store',
        'x-wps-included': String(file.included),
        'x-wps-excluded': String(file.excluded.length),
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toProblem(requestId), {
        status: error.status,
        headers: { 'x-request-id': requestId },
      });
    }
    logger.error({ err: error, requestId }, 'wps export failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}
