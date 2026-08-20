import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { ulid } from 'ulid';
import { AppError, Invalid } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { prismaRead } from '@/lib/db';
import { resolveCtx } from '@/lib/auth/session';
import { assertPermission } from '@/lib/security/rbac';
import { assertModuleEntitlement } from '@/lib/security/entitlements';
import { visibilityWhere } from '@/lib/security/visibility';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { audit } from '@/lib/security/audit';
import { consume, limits } from '@/lib/security/ratelimit';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import { resolveColumns, storedColumnsFor } from '@/lib/grid/columns';

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
    prismaRead.organizationSetting.findUnique({ where: { tenantId: ctx.tenantId }, select: { gridColumns: true } }),
    loadFieldRules(ctx, 'LEAD'),
  ]);

  const columns = resolveColumns('LEAD', storedColumnsFor(setting?.gridColumns, 'LEAD'));
  const value = (row: Record<string, any>, key: string) => {
    switch (key) {
      case 'stage':
        return row.stage?.name;
      case 'owner':
        return row.owner?.fullName ?? 'Unassigned';
      default:
        return row[key];
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
  const encoder = new TextEncoder();
  let cursor: string | null = null;
  let exported = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('﻿' + columns.map((column) => csvCell(column.label)).join(',') + '\r\n'));
    },
    async pull(controller) {
      const page = await prismaRead.lead.findMany({
        where,
        orderBy: { id: 'asc' },
        // The last page is trimmed to land exactly on the cap rather than
        // overshooting it by up to PAGE-1 rows.
        take: Math.min(PAGE, MAX_ROWS - exported),
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
        },
      });

      if (page.length === 0 || exported >= MAX_ROWS) {
        // Audited on completion so the record reflects what actually left the
        // system — including `truncated`, because a caller who received a capped
        // file and a reviewer reading this row must both be able to tell that
        // the export is not the whole answer.
        await audit(ctx, {
          event: 'EXPORT_REQUESTED',
          objectType: 'leads',
          metadata: {
            rows: exported,
            filter: params.filter ?? null,
            truncated: exported >= MAX_ROWS,
            ...(exported >= MAX_ROWS ? { limit: MAX_ROWS } : {}),
          },
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
