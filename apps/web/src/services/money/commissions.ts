/**
 * The commission ledger.
 *
 * Two rules run through everything here, and both are structural rather than
 * procedural because money is where "we always remember to" stops being good
 * enough.
 *
 * **A commission freezes the rule that made it.** The rate, the mode, the slab
 * version and a full band-by-band breakdown are copied onto the row at accrual
 * and never re-read. A workspace that renegotiates in March must not restate
 * February, and a payout already made must stay reconcilable against the number
 * that produced it — the same reasoning the HR settlement snapshot uses.
 *
 * **Nothing is deleted and nothing is edited backwards.** A cancelled sale
 * produces a reversal row carrying a negative amount and pointing at what it
 * reverses; the original is left exactly as it was.
 */
import { Prisma } from '@prisma/client';
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx, type TxClient } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { can, type Ctx } from '@/lib/security/rbac';
import { applySlab, splitAmount, type Band, type SlabBasis, type SlabMode } from './slabs';

export const COMMISSION_STATUSES = ['ACCRUED', 'CONFIRMED', 'COLLECTED', 'PAID', 'CLAWED_BACK'] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

/**
 * Legal moves.
 *
 * Forward only, one step at a time. Money does not skip from accrued to paid:
 * each stage is somebody's decision or somebody's bank transfer, and collapsing
 * two of them is how a commission gets paid on a sale whose cash never arrived.
 *
 * CLAWED_BACK is not reachable from here — it is not a transition of the
 * original row but a second row that reverses it.
 */
const ALLOWED: Record<CommissionStatus, readonly CommissionStatus[]> = {
  ACCRUED: ['CONFIRMED'],
  CONFIRMED: ['COLLECTED'],
  COLLECTED: ['PAID'],
  PAID: [],
  CLAWED_BACK: [],
};

export const canTransition = (from: CommissionStatus, to: CommissionStatus) => ALLOWED[from].includes(to);

/**
 * The slab in force for a booking, at the booking's own date.
 *
 * Most specific wins: a slab naming the project beats one naming the developer,
 * which beats the workspace default. Unapproved slabs are invisible — the spec
 * requires finance to sign the rules off, so an unsigned rule cannot pay anybody
 * even if somebody drafted it.
 */
export async function slabFor(
  tx: TxClient,
  tenantId: string,
  booking: { projectId: string | null; listingId: string | null; bookingDate: Date },
  listingType?: string | null,
) {
  const candidates = await tx.commissionSlab.findMany({
    where: {
      tenantId,
      isActive: true,
      approvedById: { not: null },
      effectiveFrom: { lte: booking.bookingDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: booking.bookingDate } }],
    },
    include: { bands: { orderBy: { position: 'asc' } } },
  });

  if (candidates.length === 0) return null;

  const score = (s: { projectId: string | null; developerId: string | null; listingType: string | null }) =>
    s.projectId && s.projectId === booking.projectId
      ? 3
      : s.listingType && s.listingType === listingType
        ? 2
        : !s.projectId && !s.developerId && !s.listingType
          ? 1
          : 0;

  const applicable = candidates.filter((s) => score(s) > 0).sort((a, b) => score(b) - score(a));
  return applicable[0] ?? null;
}

export interface AccrueInput {
  ctx: Ctx;
  bookingId: string;
  /** Who is paid, and in what proportion. Must total 100. */
  splits?: { userId: string; sharePct: number }[];
}

/**
 * Turns a confirmed booking into money owed.
 *
 * Refuses rather than guessing when no signed-off slab covers the booking. That
 * refusal is the module's contract with the spec: until finance has documented
 * and approved the rules, nothing accrues, and the message says exactly that
 * instead of quietly paying zero.
 */
export async function accrueCommission(input: AccrueInput) {
  const { ctx } = input;

  return withTx(ctx.tenantId, async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: input.bookingId, tenantId: ctx.tenantId, deletedAt: null },
      include: { listing: { select: { listingType: true } } },
    });
    if (!booking) throw NotFound('Booking');
    if (booking.status !== 'CONFIRMED') {
      throw Conflict('Only a confirmed booking accrues commission. Confirm the sale first.');
    }

    const existing = await tx.commission.count({
      where: { tenantId: ctx.tenantId, bookingId: booking.id, status: { not: 'CLAWED_BACK' } },
    });
    if (existing > 0) throw Conflict('This booking has already accrued. Adjust the split instead.');

    const slab = await slabFor(tx, ctx.tenantId, booking, booking.listing?.listingType);
    if (!slab) {
      throw Invalid([
        {
          field: 'slab',
          code: 'no_signed_slab',
          message:
            'No approved commission slab covers this booking. A slab must be entered and signed off before anything can accrue.',
        },
      ]);
    }

    // PERCENT_OF_AGENCY_FEE computes on what the developer pays the agency, not
    // on what the client paid. A booking that has not recorded the agency fee
    // cannot use that basis, and falling back to the sale value would silently
    // multiply somebody's commission by twenty.
    const base = slab.basis === 'PERCENT_OF_AGENCY_FEE' ? booking.agencyFee : (booking.saleValue as Prisma.Decimal);
    if (!base) {
      throw Invalid([
        {
          field: 'agencyFee',
          code: 'required',
          message: 'This slab pays on the agency fee, and this booking has not recorded one.',
        },
      ]);
    }

    const result = applySlab({
      base,
      mode: slab.mode as SlabMode,
      basis: slab.basis as SlabBasis,
      bands: slab.bands as unknown as Band[],
    });

    const splits = (input.splits ?? [{ userId: booking.ownerId, sharePct: 100 }]).map((s) => ({
      userId: s.userId,
      sharePct: new Prisma.Decimal(s.sharePct),
    }));
    const parts = splitAmount(result.amount, splits);

    const rows = [];
    for (const part of parts) {
      rows.push(
        await tx.commission.create({
          data: {
            tenantId: ctx.tenantId,
            bookingId: booking.id,
            userId: part.userId,
            status: 'ACCRUED',
            // The frozen copy. Never re-read after this moment.
            slabId: slab.id,
            slabVersion: slab.version,
            slabMode: slab.mode,
            slabBasis: slab.basis,
            effectiveRatePct: result.effectiveRatePct,
            calculation: {
              base: base.toString(),
              gross: result.amount.toString(),
              bands: result.breakdown,
              slabName: slab.name,
            } as unknown as Prisma.InputJsonValue,
            baseAmount: base,
            sharePct: part.sharePct,
            amount: part.amount,
            currency: booking.currency,
            createdById: ctx.actor.id,
            updatedById: ctx.actor.id,
          },
        }),
      );
    }

    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'commissions',
        recordId: booking.id,
        previousValue: {},
        newValue: {
          slab: `${slab.name} v${slab.version}`,
          base: base.toString(),
          gross: result.amount.toString(),
          split: parts.map((p) => ({ userId: p.userId, amount: p.amount.toString() })),
        },
      },
      tx,
    );

    return { commissions: rows, gross: result.amount, breakdown: result.breakdown };
  });
}

export interface TransitionInput {
  ctx: Ctx;
  commissionId: string;
  to: CommissionStatus;
  note?: string;
}

export async function transitionCommission(input: TransitionInput) {
  const { ctx } = input;

  return withTx(ctx.tenantId, async (tx) => {
    const commission = await tx.commission.findFirst({
      where: { id: input.commissionId, tenantId: ctx.tenantId },
      include: { booking: { select: { collectedAt: true, status: true } } },
    });
    if (!commission) throw NotFound('Commission');

    const from = commission.status as CommissionStatus;
    if (from === input.to) throw Conflict(`This commission is already ${input.to.toLowerCase()}.`);
    if (!canTransition(from, input.to)) {
      throw Invalid([
        {
          field: 'status',
          code: 'illegal_transition',
          message: `A ${from.toLowerCase()} commission cannot become ${input.to.toLowerCase().replace('_', ' ')}.`,
        },
      ]);
    }

    if (input.to === 'CONFIRMED' && !can(ctx, 'commissions', 'APPROVE')) {
      throw Forbidden('Confirming a commission is an approval.');
    }

    // The gate that matters. Commission is collected when the client's money is
    // in — not when somebody decides it will be. Without this the ledger shows
    // cash the business does not have.
    if (input.to === 'COLLECTED' && !commission.booking.collectedAt) {
      throw Invalid([
        {
          field: 'status',
          code: 'not_collected',
          message: 'The booking has no collection date. Record when the client paid before collecting commission.',
        },
      ]);
    }

    // PAID is set by the payout run, which is the thing that actually moves
    // money. Marking one commission paid by hand leaves it attached to no
    // payment and invisible to reconciliation.
    if (input.to === 'PAID') {
      throw Invalid([
        {
          field: 'status',
          code: 'payout_required',
          message: 'Commissions are paid by a payout run, not one at a time.',
        },
      ]);
    }

    const updated = await tx.commission.update({
      where: { id: commission.id, tenantId: ctx.tenantId },
      data: {
        status: input.to,
        confirmedById: input.to === 'CONFIRMED' ? ctx.actor.id : undefined,
        confirmedAt: input.to === 'CONFIRMED' ? new Date() : undefined,
        collectedAt: input.to === 'COLLECTED' ? new Date() : undefined,
        updatedById: ctx.actor.id,
      },
    });

    await audit(
      ctx,
      {
        event: 'STAGE_CHANGED',
        objectType: 'commissions',
        recordId: commission.id,
        previousValue: { status: from, amount: commission.amount.toString() },
        newValue: { status: input.to, note: input.note },
      },
      tx,
    );

    return { commission: updated, from };
  });
}

export interface ClawbackInput {
  ctx: Ctx;
  bookingId: string;
  reason: string;
}

/**
 * Reversing commissions on a sale that fell through.
 *
 * A second row per commission, negative, pointing at the original — never an
 * edit and never a delete. The original is evidence: somebody was told they had
 * earned that, and a ledger that quietly loses the entry cannot explain a
 * payslip that already went out.
 *
 * A commission already PAID still claws back. The money left the business and
 * the reversal is what makes the next payout net it off; pretending otherwise
 * would leave the business short with no record of why.
 */
export async function clawback(input: ClawbackInput) {
  const { ctx } = input;
  const reason = input.reason.trim();
  if (reason.length < 5) {
    throw Invalid([{ field: 'reason', code: 'required', message: 'Say why this commission is being reversed.' }]);
  }
  if (!can(ctx, 'commissions', 'APPROVE')) throw Forbidden('Clawing back a commission is an approval.');

  return withTx(ctx.tenantId, async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: input.bookingId, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, status: true, currency: true },
    });
    if (!booking) throw NotFound('Booking');

    const live = await tx.commission.findMany({
      where: { tenantId: ctx.tenantId, bookingId: booking.id, status: { not: 'CLAWED_BACK' }, reversesId: null },
    });
    if (live.length === 0) throw Conflict('There is nothing on this booking to reverse.');

    const already = await tx.commission.findMany({
      where: { tenantId: ctx.tenantId, reversesId: { in: live.map((c) => c.id) } },
      select: { reversesId: true },
    });
    const reversed = new Set(already.map((a) => a.reversesId));
    const outstanding = live.filter((c) => !reversed.has(c.id));

    // Refused rather than returning an empty list. A second press that appears
    // to succeed and changes nothing is how somebody concludes the reversal did
    // not work and goes looking for another way to do it. The unique index on
    // `reversesId` would stop the double write; this is what explains it.
    if (outstanding.length === 0) {
      throw Conflict('Every commission on this booking has already been reversed.');
    }

    const rows = [];
    for (const original of outstanding) {
      rows.push(
        await tx.commission.create({
          data: {
            tenantId: ctx.tenantId,
            bookingId: booking.id,
            userId: original.userId,
            status: 'CLAWED_BACK',
            reversesId: original.id,
            clawbackNote: reason,
            // The frozen rule is copied across too, so the reversal reconciles
            // against the same arithmetic that produced the original.
            slabId: original.slabId,
            slabVersion: original.slabVersion,
            slabMode: original.slabMode,
            slabBasis: original.slabBasis,
            effectiveRatePct: original.effectiveRatePct,
            calculation: original.calculation as Prisma.InputJsonValue,
            baseAmount: original.baseAmount,
            sharePct: original.sharePct,
            amount: original.amount.negated(),
            currency: original.currency,
            createdById: ctx.actor.id,
            updatedById: ctx.actor.id,
          },
        }),
      );
    }

    await audit(
      ctx,
      {
        event: 'RECORD_UPDATED',
        objectType: 'commissions',
        recordId: booking.id,
        previousValue: { live: live.map((c) => c.amount.toString()) },
        newValue: { reversed: rows.map((r) => r.amount.toString()), reason },
      },
      tx,
    );

    return { reversals: rows, reason };
  });
}

/**
 * The reconciliation report: every amount, tied to the booking that produced it.
 *
 * Deliberately built from the commission rows rather than from a running total
 * anywhere, so it cannot agree with a balance that has drifted. If this and the
 * payouts disagree, the payouts are wrong.
 */
export async function reconciliation(tenantId: string, from: Date, to: Date) {
  const rows = await prisma.commission.findMany({
    where: { tenantId, createdAt: { gte: from, lte: to } },
    include: {
      booking: {
        select: { id: true, reference: true, saleValue: true, currency: true, status: true, bookingDate: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const byStatus = new Map<string, Prisma.Decimal>();
  let net = new Prisma.Decimal(0);
  for (const row of rows) {
    byStatus.set(row.status, (byStatus.get(row.status) ?? new Prisma.Decimal(0)).plus(row.amount));
    net = net.plus(row.amount);
  }

  return {
    from,
    to,
    lines: rows.map((r) => ({
      commissionId: r.id,
      bookingReference: r.booking.reference,
      bookingStatus: r.booking.status,
      saleValue: r.booking.saleValue,
      userId: r.userId,
      status: r.status,
      baseAmount: r.baseAmount,
      effectiveRatePct: r.effectiveRatePct,
      sharePct: r.sharePct,
      amount: r.amount,
      currency: r.currency,
      reversesId: r.reversesId,
    })),
    totals: {
      net,
      byStatus: Object.fromEntries([...byStatus].map(([k, v]) => [k, v.toString()])),
      count: rows.length,
    },
  };
}
