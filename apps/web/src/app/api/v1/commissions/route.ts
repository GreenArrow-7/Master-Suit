import { z } from 'zod';
import { mergeWhere } from '@/lib/api/where';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { visibilityWhere } from '@/lib/security/visibility';
import { accrueCommission, clawback, transitionCommission, COMMISSION_STATUSES } from '@/services/money/commissions';

const listQuery = z
  .object({
    bookingId: z.string().cuid().optional(),
    userId: z.string().optional(),
    status: z.enum(COMMISSION_STATUSES).optional(),
    payoutId: z.string().cuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

/** What somebody has earned. Owner-scoped, so an agent sees their own. */
export const GET = route(
  { module: 'commissions', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    // Commissions key on userId, not ownerId — the whole point is whose earnings they are.
    const scope = await visibilityWhere(ctx, 'commissions', 'VIEW', { ownerField: 'userId' });
    const data = await prisma.commission.findMany({
      where: mergeWhere(
        scope,
        query.bookingId ? { bookingId: query.bookingId } : null,
        query.userId ? { userId: query.userId } : null,
        query.status ? { status: query.status } : null,
        query.payoutId ? { payoutId: query.payoutId } : null,
      ),
      select: {
        id: true,
        userId: true,
        status: true,
        baseAmount: true,
        effectiveRatePct: true,
        sharePct: true,
        amount: true,
        currency: true,
        slabVersion: true,
        slabMode: true,
        slabBasis: true,
        reversesId: true,
        payoutId: true,
        paidAt: true,
        createdAt: true,
        booking: { select: { id: true, reference: true, saleValue: true, status: true, bookingDate: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return { data };
  },
);

const accrueBody = z.object({ action: z.literal('ACCRUE'), bookingId: z.string().cuid() }).strict();

const clawbackBody = z
  .object({
    action: z.literal('CLAWBACK'),
    bookingId: z.string().cuid(),
    reason: z.string().min(4).max(1000),
  })
  .strict();

/**
 * Accrual and reversal.
 *
 * Both are POSTs because both create rows — a reversal is a new negative
 * commission, not an edit of the one it cancels. Nothing here writes a rate:
 * the slab decides, and if finance has not signed one, accrual refuses.
 */
export const POST = route(
  {
    module: 'commissions',
    productModule: 'SALES',
    // EDIT covers both: accrual is a derived write, and the clawback branch is
    // separately gated on commissions:APPROVE inside the service.
    action: 'EDIT',
    body: z.discriminatedUnion('action', [accrueBody, clawbackBody]),
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => {
    if (body.action === 'ACCRUE') {
      return accrueCommission({ ctx, bookingId: body.bookingId });
    }
    return clawback({ ctx, bookingId: body.bookingId, reason: body.reason });
  },
);

const transitionBody = z
  .object({
    commissionId: z.string().cuid(),
    to: z.enum(COMMISSION_STATUSES),
    note: z.string().max(1000).optional(),
  })
  .strict();

/**
 * Moving one commission forward a stage.
 *
 * PAID is not reachable here — a payout run does that, so that every paid
 * amount is attached to the transfer that settled it.
 */
export const PATCH = route(
  {
    module: 'commissions',
    productModule: 'SALES',
    action: 'EDIT',
    body: transitionBody,
    auditEvent: 'STAGE_CHANGED',
  },
  async ({ ctx, body }) => transitionCommission({ ctx, commissionId: body.commissionId, to: body.to, note: body.note }),
);
