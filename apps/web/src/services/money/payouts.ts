/**
 * Payout runs.
 *
 * The only thing that marks a commission PAID, deliberately. Marking one by
 * hand would leave it attached to no payment, and a reconciliation that cannot
 * tie an amount to the transfer that settled it is not a reconciliation.
 *
 * A run gathers what is already COLLECTED — the client's money is in — nets off
 * any clawbacks against the same person, and produces one statement. Approval
 * and payment are separate steps because they are separate people: whoever
 * builds the run is not whoever releases the money.
 */
import { Prisma } from '@prisma/client';
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx, type TxClient } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { can, type Ctx } from '@/lib/security/rbac';
import { nextReference } from '@/services/shared/reference';

export const PAYOUT_STATUSES = ['DRAFT', 'APPROVED', 'PAID', 'CANCELLED'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

const ALLOWED: Record<PayoutStatus, readonly PayoutStatus[]> = {
  DRAFT: ['APPROVED', 'CANCELLED'],
  APPROVED: ['PAID', 'CANCELLED'],
  PAID: [],
  CANCELLED: [],
};

export const canTransition = (from: PayoutStatus, to: PayoutStatus) => ALLOWED[from].includes(to);

const ZERO = new Prisma.Decimal(0);

/** Recomputes the total from the attached rows. Never incremented in place. */
async function retotal(tx: TxClient, tenantId: string, payoutId: string) {
  const rows = await tx.commission.findMany({
    where: { tenantId, payoutId },
    select: { amount: true },
  });
  const total = rows.reduce((sum, r) => sum.plus(r.amount), ZERO);
  await tx.payout.update({ where: { id: payoutId, tenantId }, data: { totalAmount: total } });
  return total;
}

export interface BuildPayoutInput {
  ctx: Ctx;
  userId: string;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Gathers everything payable to one person for a period.
 *
 * Two things go in: commissions that reached COLLECTED, and clawbacks that have
 * not yet been netted off. The clawbacks are the reason a run can come out
 * negative, and it is allowed to — a person who was overpaid last month owes it
 * back, and hiding that by filtering negatives out would quietly write the debt
 * off.
 */
export async function buildPayout(input: BuildPayoutInput) {
  const { ctx } = input;
  if (input.periodEnd < input.periodStart) {
    throw Invalid([{ field: 'periodEnd', code: 'range', message: 'The period ends before it starts.' }]);
  }

  return withTx(ctx.tenantId, async (tx) => {
    const open = await tx.payout.findFirst({
      where: { tenantId: ctx.tenantId, userId: input.userId, status: { in: ['DRAFT', 'APPROVED'] } },
      select: { id: true, reference: true, status: true },
    });
    if (open) {
      throw Conflict(`${open.reference} is still ${open.status.toLowerCase()} for this person. Settle it first.`);
    }

    const payable = await tx.commission.findMany({
      where: {
        tenantId: ctx.tenantId,
        userId: input.userId,
        payoutId: null,
        status: { in: ['COLLECTED', 'CLAWED_BACK'] },
        createdAt: { gte: input.periodStart, lte: input.periodEnd },
      },
      select: { id: true, amount: true, currency: true },
    });

    if (payable.length === 0) {
      throw Conflict('Nothing is payable to this person for that period.');
    }

    // One currency per run. Netting dirhams against rupees produces a number
    // that means nothing and a transfer nobody can make.
    const currencies = new Set(payable.map((c) => c.currency));
    if (currencies.size > 1) {
      throw Invalid([
        {
          field: 'currency',
          code: 'mixed',
          message: `This period mixes ${[...currencies].join(' and ')}. Run one payout per currency.`,
        },
      ]);
    }

    const reference = await nextReference(tx, ctx.tenantId, 'PAYOUT');
    const payout = await tx.payout.create({
      data: {
        tenantId: ctx.tenantId,
        reference,
        userId: input.userId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        currency: [...currencies][0],
        createdById: ctx.actor.id,
      },
    });

    await tx.commission.updateMany({
      where: { tenantId: ctx.tenantId, id: { in: payable.map((c) => c.id) } },
      data: { payoutId: payout.id },
    });

    const total = await retotal(tx, ctx.tenantId, payout.id);

    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'payouts',
        recordId: payout.id,
        previousValue: {},
        newValue: { reference, userId: input.userId, lines: payable.length, total: total.toString() },
      },
      tx,
    );

    return { payout: { ...payout, totalAmount: total }, lines: payable.length };
  });
}

export interface DecidePayoutInput {
  ctx: Ctx;
  payoutId: string;
  to: PayoutStatus;
  paymentRef?: string;
  note?: string;
}

export async function decidePayout(input: DecidePayoutInput) {
  const { ctx } = input;

  return withTx(ctx.tenantId, async (tx) => {
    const payout = await tx.payout.findFirst({
      where: { id: input.payoutId, tenantId: ctx.tenantId },
    });
    if (!payout) throw NotFound('Payout');

    const from = payout.status as PayoutStatus;
    if (!canTransition(from, input.to)) {
      throw Invalid([
        {
          field: 'status',
          code: 'illegal_transition',
          message: `A ${from.toLowerCase()} payout cannot become ${input.to.toLowerCase()}.`,
        },
      ]);
    }

    if ((input.to === 'APPROVED' || input.to === 'PAID') && !can(ctx, 'payouts', 'APPROVE')) {
      throw Forbidden('Releasing money is an approval.');
    }

    // Whoever built the run does not approve it. The one control that stops a
    // single person moving money to themselves end to end.
    if (input.to === 'APPROVED' && payout.createdById === ctx.actor.id) {
      throw Forbidden('You built this run. Someone else has to approve it.');
    }
    if (input.to === 'PAID' && !payout.approvedById) {
      throw Conflict('This payout has not been approved.');
    }

    const updated = await tx.payout.update({
      where: { id: payout.id, tenantId: ctx.tenantId },
      data: {
        status: input.to,
        approvedById: input.to === 'APPROVED' ? ctx.actor.id : undefined,
        approvedAt: input.to === 'APPROVED' ? new Date() : undefined,
        paidAt: input.to === 'PAID' ? new Date() : undefined,
        paymentRef: input.to === 'PAID' ? input.paymentRef : undefined,
        note: input.note ?? undefined,
      },
    });

    if (input.to === 'PAID') {
      // The one place a commission becomes PAID, and it happens with the
      // transfer rather than before it.
      await tx.commission.updateMany({
        where: { tenantId: ctx.tenantId, payoutId: payout.id, status: 'COLLECTED' },
        data: { status: 'PAID', paidAt: new Date(), updatedById: ctx.actor.id },
      });
    }

    if (input.to === 'CANCELLED') {
      // Released back to the pool so a later run can pick them up. A cancelled
      // run must not strand somebody's earnings.
      await tx.commission.updateMany({
        where: { tenantId: ctx.tenantId, payoutId: payout.id },
        data: { payoutId: null },
      });
      await tx.payout.update({ where: { id: payout.id, tenantId: ctx.tenantId }, data: { totalAmount: ZERO } });
    }

    await audit(
      ctx,
      {
        event: 'STAGE_CHANGED',
        objectType: 'payouts',
        recordId: payout.id,
        previousValue: { status: from, total: payout.totalAmount.toString() },
        newValue: { status: input.to, paymentRef: input.paymentRef, note: input.note },
      },
      tx,
    );

    return { payout: updated, from };
  });
}

/** One person's statement: the lines, and what each traces back to. */
export async function statement(tenantId: string, payoutId: string) {
  const payout = await prisma.payout.findFirst({
    where: { id: payoutId, tenantId },
    include: {
      commissions: {
        include: {
          booking: { select: { reference: true, saleValue: true, bookingDate: true, status: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!payout) throw NotFound('Payout');

  return {
    payout: {
      id: payout.id,
      reference: payout.reference,
      userId: payout.userId,
      status: payout.status,
      periodStart: payout.periodStart,
      periodEnd: payout.periodEnd,
      totalAmount: payout.totalAmount,
      currency: payout.currency,
      paidAt: payout.paidAt,
      paymentRef: payout.paymentRef,
    },
    lines: payout.commissions.map((c) => ({
      commissionId: c.id,
      bookingReference: c.booking.reference,
      bookingDate: c.booking.bookingDate,
      saleValue: c.booking.saleValue,
      baseAmount: c.baseAmount,
      effectiveRatePct: c.effectiveRatePct,
      sharePct: c.sharePct,
      amount: c.amount,
      status: c.status,
      isReversal: c.reversesId !== null,
      /** The frozen working, so a disputed line can be re-read rather than re-run. */
      calculation: c.calculation,
    })),
  };
}
