import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ulid } from 'ulid';
import { AppError, Invalid, NotFound } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/db';
import { resolveCtx } from '@/lib/auth/session';
import { assertPermission, type Ctx } from '@/lib/security/rbac';
import { assertModuleEntitlement } from '@/lib/security/entitlements';
import { visibilityWhere } from '@/lib/security/visibility';
import { audit } from '@/lib/security/audit';
import { consume, limits } from '@/lib/security/ratelimit';
import { csvHeaders, csvStream, type CsvColumn } from '@/lib/csv';

/**
 * CSV export for the list routes that had none.
 *
 * §4 asks every list to be exportable. Leads already had one — a hand-written
 * route with its own kernel-shaped error handling — and copying that six times
 * would have been six chances to forget the scope filter or the permission.
 *
 * One route, one definition per resource. What a definition may not do is
 * decide who can see what: the scope comes from `visibilityWhere` on the same
 * module and action the list route uses, and the permission gate is `EXPORT` on
 * that module, which every resource here already defines.
 *
 * Not routed through the API kernel, for the same reason the lead export is not:
 * that helper always answers JSON, and an export has to stream a file. The same
 * gates run here in the same order.
 */

interface Resource {
  /** Permission module. EXPORT on it is the gate. */
  module: string;
  /** Rows are scoped exactly as the list route scopes them. */
  ownerField?: string;
  columns: CsvColumn<any>[];
  page: (ctx: Ctx, where: Record<string, unknown>, cursor: string | null, take: number) => Promise<{ id: string }[]>;
}

const date = (value: Date | null | undefined) => value?.toISOString().slice(0, 10) ?? null;
const decimal = (value: { toString(): string } | null | undefined) => value?.toString() ?? null;

const RESOURCES: Record<string, Resource> = {
  listings: {
    module: 'listings',
    columns: [
      { label: 'Reference', value: (r) => r.reference },
      { label: 'Title', value: (r) => r.title },
      { label: 'Type', value: (r) => r.listingType },
      { label: 'Status', value: (r) => r.status },
      { label: 'Bedrooms', value: (r) => r.bedrooms },
      { label: 'Area (sqft)', value: (r) => r.areaSqft },
      { label: 'Price', value: (r) => decimal(r.price) },
      { label: 'Currency', value: (r) => r.currency },
      { label: 'Owner', value: (r) => r.ownerId ?? 'Unassigned' },
      { label: 'Created', value: (r) => date(r.createdAt) },
    ],
    page: (ctx, where, cursor, take) =>
      prisma.listing.findMany({
        where: { ...where, deletedAt: null },
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          reference: true,
          title: true,
          listingType: true,
          status: true,
          bedrooms: true,
          areaSqft: true,
          price: true,
          currency: true,
          createdAt: true,
          ownerId: true,
        },
      }),
  },

  projects: {
    module: 'projects',
    columns: [
      { label: 'Code', value: (r) => r.code },
      { label: 'Name', value: (r) => r.name },
      { label: 'Status', value: (r) => r.status },
      { label: 'Possession', value: (r) => r.possessionStatus },
      { label: 'Created', value: (r) => date(r.createdAt) },
    ],
    page: (ctx, where, cursor, take) =>
      prisma.project.findMany({
        where: { ...where, deletedAt: null },
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, code: true, name: true, status: true, possessionStatus: true, createdAt: true },
      }),
  },

  contacts: {
    module: 'contacts',
    columns: [
      { label: 'Reference', value: (r) => r.reference },
      { label: 'Name', value: (r) => r.fullName },
      { label: 'Job title', value: (r) => r.jobTitle },
      { label: 'Email', value: (r) => r.email },
      { label: 'Phone', value: (r) => r.phone },
      { label: 'Account', value: (r) => r.account?.name ?? null },
      { label: 'Owner', value: (r) => r.owner?.fullName ?? 'Unassigned' },
      { label: 'Created', value: (r) => date(r.createdAt) },
    ],
    page: (ctx, where, cursor, take) =>
      prisma.contact.findMany({
        where: { ...where, deletedAt: null },
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          reference: true,
          fullName: true,
          jobTitle: true,
          email: true,
          phone: true,
          createdAt: true,
          account: { select: { name: true } },
          owner: { select: { fullName: true } },
        },
      }),
  },

  accounts: {
    module: 'accounts',
    columns: [
      { label: 'Reference', value: (r) => r.reference },
      { label: 'Name', value: (r) => r.name },
      { label: 'Industry', value: (r) => r.industry },
      { label: 'Website', value: (r) => r.website },
      { label: 'Owner', value: (r) => r.owner?.fullName ?? 'Unassigned' },
      { label: 'Created', value: (r) => date(r.createdAt) },
    ],
    page: (ctx, where, cursor, take) =>
      prisma.account.findMany({
        where: { ...where, deletedAt: null },
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          reference: true,
          name: true,
          industry: true,
          website: true,
          createdAt: true,
          owner: { select: { fullName: true } },
        },
      }),
  },

  opportunities: {
    module: 'opportunities',
    columns: [
      { label: 'Reference', value: (r) => r.reference },
      { label: 'Name', value: (r) => r.name },
      { label: 'Stage', value: (r) => r.stage?.name ?? null },
      { label: 'Status', value: (r) => r.status },
      { label: 'Amount', value: (r) => decimal(r.amount) },
      { label: 'Currency', value: (r) => r.currency },
      { label: 'Probability', value: (r) => r.probability },
      { label: 'Expected close', value: (r) => date(r.expectedCloseDate) },
      { label: 'Owner', value: (r) => r.owner?.fullName ?? 'Unassigned' },
    ],
    page: (ctx, where, cursor, take) =>
      prisma.opportunity.findMany({
        where: { ...where, deletedAt: null },
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          reference: true,
          name: true,
          status: true,
          amount: true,
          currency: true,
          probability: true,
          expectedCloseDate: true,
          stage: { select: { name: true } },
          owner: { select: { fullName: true } },
        },
      }),
  },

  commissions: {
    module: 'commissions',
    // Earnings key on userId, not the ownerId the rest of the CRM uses.
    ownerField: 'userId',
    columns: [
      { label: 'Booking', value: (r) => r.booking?.reference ?? null },
      { label: 'Who', value: (r) => r.userId },
      { label: 'Status', value: (r) => r.status },
      { label: 'Base', value: (r) => decimal(r.baseAmount) },
      { label: 'Rate %', value: (r) => decimal(r.effectiveRatePct) },
      { label: 'Share %', value: (r) => decimal(r.sharePct) },
      { label: 'Amount', value: (r) => decimal(r.amount) },
      { label: 'Currency', value: (r) => r.currency },
      { label: 'Reversal', value: (r) => (r.reversesId ? 'yes' : 'no') },
      { label: 'Paid', value: (r) => date(r.paidAt) },
    ],
    page: (ctx, where, cursor, take) =>
      prisma.commission.findMany({
        where,
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          userId: true,
          status: true,
          baseAmount: true,
          effectiveRatePct: true,
          sharePct: true,
          amount: true,
          currency: true,
          reversesId: true,
          paidAt: true,
          booking: { select: { reference: true } },
        },
      }),
  },
};

export async function GET(req: Request, context: { params: Promise<{ resource: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    return await handle(req, await context.params, requestId);
  } catch (err) {
    // Outside the API kernel, so errors have to be translated the way it would.
    // Without this an unauthorised export answers 500 and reads as a fault
    // rather than a refusal.
    const headers = { 'x-request-id': requestId, 'content-type': 'application/problem+json' };
    if (err instanceof ZodError) {
      const invalid = Invalid(err.issues.map((i) => ({ field: i.path.join('.'), code: i.code, message: i.message })));
      return NextResponse.json(invalid.toProblem(requestId), { status: invalid.status, headers });
    }
    if (err instanceof AppError) {
      if (err.status >= 500) logger.error({ err, requestId }, 'export failed');
      else logger.warn({ requestId, code: err.code, status: err.status }, 'export rejected');
      return NextResponse.json(err.toProblem(requestId), { status: err.status, headers });
    }
    logger.error({ err, requestId }, 'export failed');
    const problem = new AppError(500, 'internal-error', 'Something went wrong on our side.', [], false);
    return NextResponse.json(problem.toProblem(requestId), { status: 500, headers });
  }
}

async function handle(req: Request, params: { resource: string }, requestId: string) {
  const resource = RESOURCES[params.resource];
  if (!resource) throw NotFound('Export');

  const ctx = await resolveCtx(req, requestId);
  await assertModuleEntitlement(ctx.tenantId, 'SALES');
  // EXPORT, not VIEW. Reading a list on screen and taking the whole thing out
  // of the building are different authorities, and every module here already
  // defines the second.
  assertPermission(ctx, resource.module, 'EXPORT');
  await consume(limits.sessionUser(ctx.actor.id));

  const where = await visibilityWhere(ctx, resource.module, 'VIEW', { ownerField: resource.ownerField });

  const PAGE = 500;
  const stream = csvStream({
    columns: resource.columns,
    pageSize: PAGE,
    page: (cursor) => resource.page(ctx, where, cursor, PAGE) as Promise<{ id: string }[]>,
    onDone: async (rows) => {
      await audit(ctx, {
        event: 'EXPORT_REQUESTED',
        objectType: resource.module,
        metadata: { rows },
      });
    },
  });

  return new NextResponse(stream, { headers: csvHeaders(params.resource, requestId) });
}
