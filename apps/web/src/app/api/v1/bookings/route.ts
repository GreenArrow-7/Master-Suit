import { z } from 'zod';
import { mergeWhere } from '@/lib/api/where';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { Conflict, Invalid, NotFound } from '@/lib/errors';
import { assertRecordVisible, visibilityWhere } from '@/lib/security/visibility';
import { moveUnitIn } from '@/services/inventory/unitStatus';
import { nextReference } from '@/services/shared/reference';

const listQuery = z
  .object({
    status: z.enum(['DRAFT', 'CONFIRMED', 'CANCELLED']).optional(),
    projectId: z.string().cuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

const LIST_SELECT = {
  id: true,
  reference: true,
  status: true,
  saleValue: true,
  agencyFee: true,
  currency: true,
  bookingDate: true,
  collectedAt: true,
  cancelledAt: true,
  ownerId: true,
  leadId: true,
  project: { select: { id: true, name: true } },
  listing: { select: { id: true, reference: true, title: true } },
  unit: { select: { id: true, unitNumber: true, tower: true } },
  commissions: { select: { id: true, userId: true, status: true, amount: true, currency: true } },
} as const;

/** Owner-scoped: a booking is somebody's sale, and so is the commission on it. */
export const GET = route(
  { module: 'bookings', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const scope = await visibilityWhere(ctx, 'bookings', 'VIEW');
    const data = await prisma.booking.findMany({
      where: mergeWhere(
        scope,
        { deletedAt: null },
        query.status ? { status: query.status } : null,
        query.projectId ? { projectId: query.projectId } : null,
        query.from || query.to
          ? { bookingDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
          : null,
      ),
      select: LIST_SELECT,
      orderBy: { bookingDate: 'desc' },
      take: query.limit,
    });
    return { data };
  },
);

const createBody = z
  .object({
    leadId: z.string().cuid().optional(),
    contactId: z.string().cuid().optional(),
    accountId: z.string().cuid().optional(),
    projectId: z.string().cuid().optional(),
    unitInventoryId: z.string().cuid().optional(),
    listingId: z.string().cuid().optional(),
    saleValue: z.coerce.number().positive(),
    agencyFee: z.coerce.number().nonnegative().optional(),
    currency: z.string().length(3).default('AED'),
    bookingDate: z.coerce.date(),
    agreementDate: z.coerce.date().optional(),
    notes: z.string().max(4000).optional(),
  })
  .strict();

/**
 * Recording a sale.
 *
 * Starts as a DRAFT and accrues nothing. Commission follows confirmation, which
 * is a separate decision by somebody else — a booking that paid the moment it
 * was typed would make the ledger a wish list.
 */
export const POST = route(
  {
    module: 'bookings',
    productModule: 'SALES',
    action: 'CREATE',
    body: createBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => {
    if (!body.leadId && !body.contactId && !body.accountId) {
      throw Invalid([{ field: 'leadId', code: 'required', message: 'Say who bought it.' }]);
    }
    if (!body.projectId && !body.listingId && !body.unitInventoryId) {
      throw Invalid([{ field: 'projectId', code: 'required', message: 'Say what was sold.' }]);
    }

    return withTx(ctx.tenantId, async (tx) => {
      const reference = await nextReference(tx, ctx.tenantId, 'BOOKING');
      return tx.booking.create({
        data: {
          tenantId: ctx.tenantId,
          reference,
          ownerId: ctx.actor.id,
          createdById: ctx.actor.id,
          updatedById: ctx.actor.id,
          ...body,
        },
        select: LIST_SELECT,
      });
    });
  },
);

const patchBody = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('CONFIRM'), bookingId: z.string().cuid(), agreementDate: z.coerce.date().optional() })
    .strict(),
  z
    .object({ action: z.literal('COLLECT'), bookingId: z.string().cuid(), collectedAt: z.coerce.date().optional() })
    .strict(),
  z.object({ action: z.literal('CANCEL'), bookingId: z.string().cuid(), reason: z.string().min(4).max(1000) }).strict(),
]);

/**
 * Moving a sale along.
 *
 * Three facts, each of which unlocks the next thing the ledger may do:
 * confirming makes the sale real enough to accrue against, collecting records
 * that the client's money arrived, and cancelling closes it.
 *
 * Cancelling refuses while live commissions hang off the booking. Silently
 * orphaning them would leave amounts owed against a sale that no longer exists;
 * the operator has to claw them back first, which is a deliberate act with a
 * reason attached.
 */
export const PATCH = route(
  {
    module: 'bookings',
    productModule: 'SALES',
    action: 'EDIT',
    body: patchBody,
    auditEvent: 'STAGE_CHANGED',
  },
  async ({ ctx, body }) =>
    withTx(ctx.tenantId, async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: body.bookingId, tenantId: ctx.tenantId, deletedAt: null },
        select: {
          id: true,
          status: true,
          collectedAt: true,
          ownerId: true,
          tenantId: true,
          leadId: true,
          projectId: true,
          unitInventoryId: true,
        },
      });
      if (!booking) throw NotFound('Booking');
      await assertRecordVisible(ctx, 'bookings', booking, tx, 'EDIT');

      const bad = (message: string) => Invalid([{ field: 'action', code: 'illegal_transition', message }]);

      /**
       * The booking row, locked, and its status read again.
       *
       * The read above is unlocked — it has to be, because it is what tells us
       * which unit to lock, and the unit is locked first everywhere. So by the
       * time we are ready to write, another request may have moved this
       * booking. Re-reading under the lock is the whole point of taking it:
       * without this, a CONFIRM and a CANCEL that arrive together both pass
       * their status check and the later write silently wins.
       */
      const lockBooking = async () => {
        const [locked] = await tx.$queryRaw<{ status: string }[]>`
          SELECT "status"::text AS status
          FROM "Booking"
          WHERE "id" = ${booking.id} AND "tenantId" = ${ctx.tenantId} AND "deletedAt" IS NULL
          FOR UPDATE
        `;
        if (!locked) throw NotFound('Booking');
        if (locked.status !== booking.status) {
          throw Conflict('This booking changed while you were working on it. Reload it and try again.');
        }
      };

      if (body.action === 'CONFIRM') {
        if (booking.status !== 'DRAFT') throw bad(`A ${booking.status.toLowerCase()} booking cannot be confirmed.`);

        /**
         * Client policy, 2026-09-12: every confirmed booking identifies one
         * specific inventory unit. A draft may still be vague about what is
         * being sold — that is what a draft is for — but confirmation is the
         * moment the sale becomes real enough to accrue commission against,
         * and a sale nobody can point at a flat cannot be checked against
         * anything. The database says the same thing in
         * `Booking_confirmed_requires_unit`.
         */
        if (!booking.unitInventoryId || !booking.projectId) {
          throw Invalid([
            {
              field: 'unitInventoryId',
              code: 'required',
              message:
                'Name the unit being sold before confirming. A confirmed sale has to point at one specific unit.',
            },
          ]);
        }

        /**
         * Take the unit before the booking, in that order, always.
         *
         * This is the double-sale control. The second of two concurrent
         * confirmations waits on this row lock, and when it gets in the unit
         * already reads BOOKED, which the transition table refuses. Doing it
         * inside the caller's transaction is what makes the pair atomic:
         * throwing anywhere after this rolls the unit back with the booking,
         * so a failed confirmation never leaves inventory marked sold.
         *
         * The buyer may be a contact or an account rather than a lead, so the
         * unit's own leadId pointer is filled in only when there is one. The
         * Booking is the record of who bought; that pointer is a convenience.
         */
        await moveUnitIn(tx, {
          tenantId: ctx.tenantId,
          actorId: ctx.actor.id,
          projectId: booking.projectId,
          unitId: booking.unitInventoryId,
          to: 'BOOKED',
          leadId: booking.leadId ?? undefined,
        });
        await lockBooking();

        // Where the agent sits *now*, copied onto the sale. Read back through
        // their current team instead and a transfer moves last quarter's
        // revenue to a team that did not earn it.
        const owner = await tx.user.findFirst({
          where: { id: booking.ownerId, tenantId: ctx.tenantId },
          select: { branchId: true, regionId: true, teams: { select: { teamId: true }, take: 1 } },
        });

        return tx.booking.update({
          where: { id: booking.id, tenantId: ctx.tenantId },
          data: {
            status: 'CONFIRMED',
            agreementDate: body.agreementDate,
            teamId: owner?.teams[0]?.teamId ?? null,
            branchId: owner?.branchId ?? null,
            regionId: owner?.regionId ?? null,
            updatedById: ctx.actor.id,
          },
          select: LIST_SELECT,
        });
      }

      if (body.action === 'COLLECT') {
        if (booking.status !== 'CONFIRMED') throw bad('Only a confirmed booking can be marked collected.');
        if (booking.collectedAt) throw Conflict('This booking is already marked collected.');
        await lockBooking();
        return tx.booking.update({
          where: { id: booking.id, tenantId: ctx.tenantId },
          data: { collectedAt: body.collectedAt ?? new Date(), updatedById: ctx.actor.id },
          select: LIST_SELECT,
        });
      }

      if (booking.status === 'CANCELLED') throw Conflict('This booking is already cancelled.');
      const live = await tx.commission.count({
        where: { tenantId: ctx.tenantId, bookingId: booking.id, status: { not: 'CLAWED_BACK' }, reversesId: null },
      });
      const reversed = await tx.commission.count({
        where: { tenantId: ctx.tenantId, bookingId: booking.id, reversesId: { not: null } },
      });
      if (live > reversed) {
        throw Conflict('Claw the commissions back before cancelling, so nothing is owed against a sale that is gone.');
      }

      /**
       * A cancelled sale puts the flat back on the market.
       *
       * Same lock order as confirmation, and deliberately not forgiving: if the
       * unit has since moved somewhere other than BOOKED — sold on, blocked,
       * released by hand — the transition table refuses and the cancellation
       * fails with the unit's actual state. Inventory and the ledger disagreeing
       * is the thing this whole package exists to make loud, so it is not
       * something to paper over by cancelling anyway and leaving the flat
       * marked sold.
       */
      if (booking.status === 'CONFIRMED' && booking.unitInventoryId && booking.projectId) {
        await moveUnitIn(tx, {
          tenantId: ctx.tenantId,
          actorId: ctx.actor.id,
          projectId: booking.projectId,
          unitId: booking.unitInventoryId,
          to: 'AVAILABLE',
        });
      }
      await lockBooking();

      return tx.booking.update({
        where: { id: booking.id, tenantId: ctx.tenantId },
        // cancelReason, not notes: the booking's notes are somebody's record of
        // the sale, and the database pairs the reason with cancelledAt anyway.
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: body.reason, updatedById: ctx.actor.id },
        select: LIST_SELECT,
      });
    }),
);
