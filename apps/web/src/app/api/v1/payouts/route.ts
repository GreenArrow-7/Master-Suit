import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { assertRecordVisible, visibilityWhere } from '@/lib/security/visibility';
import { buildPayout, decidePayout, statement, PAYOUT_STATUSES } from '@/services/money/payouts';

const listQuery = z
  .object({
    payoutId: z.string().cuid().optional(),
    userId: z.string().optional(),
    status: z.enum(PAYOUT_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

/** The runs, or one run's full statement when `payoutId` is given. */
export const GET = route(
  { module: 'payouts', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    if (query.payoutId) {
      const result = await statement(ctx.tenantId, query.payoutId);
      // Fetching by id skips the list's scope filter, so re-apply it here.
      // Otherwise an agent scoped to their own earnings reads anyone's
      // statement by guessing a payout id.
      await assertRecordVisible(
        ctx,
        'payouts',
        { tenantId: ctx.tenantId, userId: result.payout.userId },
        prisma,
        'VIEW',
        'userId',
      );
      return result;
    }

    const scope = await visibilityWhere(ctx, 'payouts', 'VIEW', { ownerField: 'userId' });
    const data = await prisma.payout.findMany({
      where: {
        ...scope,
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      select: {
        id: true,
        reference: true,
        userId: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        totalAmount: true,
        currency: true,
        approvedAt: true,
        paidAt: true,
        paymentRef: true,
        createdAt: true,
        _count: { select: { commissions: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return { data };
  },
);

const buildBody = z
  .object({
    userId: z.string().min(1),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
  })
  .strict();

/** Gathering a period's collected commissions into one run. Creates a DRAFT. */
export const POST = route(
  {
    module: 'payouts',
    productModule: 'SALES',
    action: 'CREATE',
    body: buildBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => buildPayout({ ctx, ...body }),
);

const decideBody = z
  .object({
    payoutId: z.string().cuid(),
    to: z.enum(PAYOUT_STATUSES),
    paymentRef: z.string().max(120).optional(),
    note: z.string().max(1000).optional(),
  })
  .strict();

/**
 * Approving, paying or cancelling a run.
 *
 * The service refuses to let whoever built it approve it, so this is two people
 * by construction rather than by policy document.
 */
export const PATCH = route(
  {
    module: 'payouts',
    productModule: 'SALES',
    // Whoever may build a run may cancel their own mistake; approving and
    // paying need payouts:APPROVE, which decidePayout checks itself.
    action: 'CREATE',
    body: decideBody,
    auditEvent: 'STAGE_CHANGED',
  },
  async ({ ctx, body }) => decidePayout({ ctx, ...body }),
);
