import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertModuleEntitlement } from '@/lib/security/entitlements';
import { requireWorkspace } from '@/lib/workspace';
import { exportReportCsv } from '@/services/hr/reports';

/**
 * A report as a CSV.
 *
 * Its own route because the response is a file rather than JSON, but the
 * authorisation is not its own: `exportReportCsv` resolves the report through
 * the same gate the screen uses, so an export cannot reach a report the UI would
 * have hidden. That is §56's requirement, and the only way to keep it true is
 * for both paths to call one function.
 *
 * No `assertPermission` here on purpose. The permission depends on which report
 * was asked for — the payroll register needs `payroll:VIEW`, headcount needs
 * `employee:VIEW` — so it is asserted per report inside, where the definition
 * is. Checking a fixed permission here would be the weaker of the two and would
 * read as if it were the whole check.
 */
export async function GET(req: Request, context: { params: Promise<{ workspaceSlug: string; reportKey: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const { workspaceSlug, reportKey } = await context.params;
    const ctx = await resolveCtx(req, requestId);
    await assertModuleEntitlement(ctx.tenantId, 'HRMS');
    await requireWorkspace(ctx, workspaceSlug, 'HRMS');

    const url = new URL(req.url);
    const date = (key: string) => {
      const raw = url.searchParams.get(key);
      if (!raw) return undefined;
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    };
    const text = (key: string) => url.searchParams.get(key) ?? undefined;

    const file = await exportReportCsv(ctx, reportKey, {
      from: date('from'),
      to: date('to'),
      departmentId: text('departmentId'),
      locationId: text('locationId'),
      employeeId: text('employeeId'),
      status: text('status'),
      cycleId: text('cycleId'),
    });

    return new NextResponse(file.content, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${file.filename.replace(/"/g, '')}"`,
        'cache-control': 'private, no-store',
        'x-row-count': String(file.rows),
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
    logger.error({ err: error, requestId }, 'report export failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}
