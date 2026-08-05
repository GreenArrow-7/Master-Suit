import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { ulid } from 'ulid';
import { AppError, Invalid } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/db';
import { resolveCtx } from '@/lib/auth/session';
import { assertPermission } from '@/lib/security/rbac';
import { assertModuleEntitlement } from '@/lib/security/entitlements';
import { visibilityWhere } from '@/lib/security/visibility';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { audit } from '@/lib/security/audit';
import { consume, limits } from '@/lib/security/ratelimit';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import { GRID_COLUMNS, resolveColumns, storedColumnsFor } from '@/lib/grid/columns';

const query = z.object({ filter: z.string().max(40).optional(), q: z.string().max(200).optional() }).strict();

const FILTERS: Record<string, (now: Date) => Record<string, unknown>> = {
  unassigned: () => ({ ownerId: null }),
  overdue: (now) => ({ nextFollowUpAt: { lt: now } }),
  breached: () => ({ slaState: 'BREACHED' }),
  high_score: () => ({ score: { gte: 70 } }),
};

/** RFC 4180: quote every field, double any embedded quote. Also blunts the
 *  spreadsheet formula-injection trick where a value starting =, +, - or @ is
 *  executed on open. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Not routed through the API kernel: that helper always answers JSON, and an export
 * has to stream a file. The same gates run here in the same order.
 */
export async function GET(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    return await handle(req, requestId);
  } catch (err) {
    // This route answers outside the API kernel, so it has to translate errors the
    // way the kernel would. Without this an unauthorised export returned 500 and
    // read as a server fault rather than a refusal.
    const headers = { 'x-request-id': requestId, 'content-type': 'application/problem+json' };
    if (err instanceof ZodError) {
      const invalid = Invalid(err.issues.map((i) => ({ field: i.path.join('.'), code: i.code, message: i.message })));
      return NextResponse.json(invalid.toProblem(requestId), { status: invalid.status, headers });
    }
    if (err instanceof AppError) {
      if (err.status >= 500) logger.error({ err, requestId }, 'lead export failed');
      else logger.warn({ requestId, code: err.code, status: err.status }, 'lead export rejected');
      return NextResponse.json(err.toProblem(requestId), { status: err.status, headers });
    }
    logger.error({ err, requestId }, 'lead export failed');
    const problem = new AppError(500, 'internal-error', 'Something went wrong on our side.', [], false);
    return NextResponse.json(problem.toProblem(requestId), { status: 500, headers });
  }
}

async function handle(req: Request, requestId: string) {
  const ctx = await resolveCtx(req, requestId);
  await assertModuleEntitlement(ctx.tenantId, 'SALES');
  assertPermission(ctx, 'leads', 'EXPORT');
  await consume(limits.sessionUser(ctx.actor.id));

  const url = new URL(req.url);
  const params = query.parse(Object.fromEntries(url.searchParams));

  const scope = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
  const extra = params.filter && FILTERS[params.filter] ? FILTERS[params.filter]!(new Date()) : {};
  const search = params.q ? { fullName: { contains: params.q, mode: 'insensitive' as const } } : {};

  const where = { ...scope, ...extra, ...search };
  const [setting, rules] = await Promise.all([
    prisma.organizationSetting.findUnique({ where: { tenantId: ctx.tenantId }, select: { gridColumns: true } }),
    loadFieldRules(ctx, 'LEAD'),
  ]);

  const columns = resolveColumns('LEAD', storedColumnsFor(setting?.gridColumns, 'LEAD'));
  const value = (row: Record<string, any>, key: string) => {
    switch (key) {
      case 'stage': return row.stage?.name;
      case 'owner': return row.owner?.fullName ?? 'Unassigned';
      default: return row[key];
    }
  };

  // Streamed in keyset pages rather than gathered into one array, so an export is
  // bounded by page size instead of by the size of the result — there is no row
  // limit and no point where the whole file sits in memory.
  const PAGE = 500;
  const encoder = new TextEncoder();
  let cursor: string | null = null;
  let exported = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('﻿' + columns.map((column) => csvCell(column.label)).join(',') + '\r\n'));
    },
    async pull(controller) {
      const page = await prisma.lead.findMany({
        where,
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true, reference: true, fullName: true, email: true, phone: true, company: true,
          score: true, grade: true, priority: true, slaState: true, nextFollowUpAt: true,
          updatedAt: true, ownerId: true,
          stage: { select: { key: true, name: true, color: true } },
          owner: { select: { fullName: true } },
        },
      });

      if (page.length === 0) {
        // Audited on completion so the record reflects what actually left the system.
        await audit(ctx, {
          event: 'EXPORT_REQUESTED',
          objectType: 'leads',
          metadata: { rows: exported, filter: params.filter ?? null },
        });
        controller.close();
        return;
      }

      // Masking runs on the export exactly as it does on the grid — an export must
      // not be a way around field-level security.
      const body = page
        .map((row) => applyFieldSecurity(ctx, 'LEAD', rules, row, LEAD_SENSITIVE_FIELDS) as Record<string, any>)
        .map((row) => columns.map((column) => csvCell(value(row, column.key))).join(','))
        .join('\r\n');

      controller.enqueue(encoder.encode(body + '\r\n'));
      exported += page.length;
      cursor = page[page.length - 1].id;
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(stream, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="leads-${stamp}.csv"`,
      'cache-control': 'no-store',
      'x-request-id': requestId,
    },
  });
}
