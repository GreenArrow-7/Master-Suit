/**
 * Agency-fee receipts, and what they permit.
 *
 * The owner's rules of 12 September 2026, D-8.1–D-8.5, in code:
 *
 *   - A receipt is recorded by a finance role and verified by a *different*
 *     person. There is no rank that lets one account do both.
 *   - A receipt carries a positive amount, a currency, the actual payment
 *     date, a reference, and evidence — a provider/bank transaction id or an
 *     uploaded document. A reference on its own is not evidence.
 *   - Commission becomes eligible only when net VERIFIED receipts fully cover
 *     `Booking.agencyFee`, in the booking's own currency. Pending, rejected
 *     and reversed money does not count; overpayment adds nothing; a booking
 *     with no agreed agency fee is not eligible until one is recorded.
 *   - A reversal is its own row with its own verifier. The original is never
 *     edited. If a verified reversal takes coverage below the fee, unpaid
 *     commission goes back to CONFIRMED and leaves its payout; commission
 *     already paid opens a recovery case for finance. Nothing is rewritten
 *     and nobody is debited automatically.
 *
 * Lock order, everywhere in this file and in the two files that call it:
 * **Booking → receipts → Commission/Payout**. A reversal being verified and a
 * payout being approved both take the booking row first, so they cannot pass
 * each other; whichever arrives second sees the other's result.
 */
import { Prisma } from '@prisma/client';
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { withTx, type TxClient } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { findReplay, recordOutcome } from '@/services/idempotency';
import { nextReference } from '@/services/shared/reference';

export const ZERO = new Prisma.Decimal(0);

/** Receipt evidence documents: their category, and the storage prefix that binds each to one booking. */
export const EVIDENCE_CATEGORY = 'agency-fee-evidence';
export const evidencePrefix = (tenantId: string, bookingId: string) => `documents/t-${tenantId}/booking-${bookingId}/`;
const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

/** One reason per way a booking can fail the 100 % rule. Stable strings, for tests and screens. */
export type CoverageReason = 'covered' | 'agency_fee_unset' | 'short' | 'currency_mismatch';

export interface Coverage {
  bookingId: string;
  currency: string;
  /** `Booking.agencyFee`, or null when none is recorded. */
  due: Prisma.Decimal | null;
  /** Σ VERIFIED receipts − Σ VERIFIED reversals, in the booking's currency. */
  verified: Prisma.Decimal;
  pending: Prisma.Decimal;
  covered: boolean;
  reason: CoverageReason;
}

/**
 * Net verified money against the fee due. Pure read; callers that are about
 * to *act* on the answer lock the booking first (`lockBooking`).
 */
export async function coverage(tx: TxClient, tenantId: string, bookingId: string): Promise<Coverage> {
  const booking = await tx.booking.findFirst({
    where: { id: bookingId, tenantId },
    select: { id: true, agencyFee: true, currency: true },
  });
  if (!booking) throw NotFound('Booking');

  const rows = await tx.agencyFeeReceipt.findMany({
    where: { tenantId, bookingId, status: { in: ['VERIFIED', 'PENDING'] } },
    select: { kind: true, status: true, amount: true, currency: true },
  });

  // Recording refuses a foreign currency, so this can only be legacy or
  // hand-edited data. Refused rather than summed: there is no conversion policy.
  if (rows.some((r) => r.currency !== booking.currency)) {
    return {
      bookingId,
      currency: booking.currency,
      due: booking.agencyFee,
      verified: ZERO,
      pending: ZERO,
      covered: false,
      reason: 'currency_mismatch',
    };
  }

  const sum = (status: 'VERIFIED' | 'PENDING') =>
    rows
      .filter((r) => r.status === status)
      .reduce((acc, r) => (r.kind === 'REVERSAL' ? acc.minus(r.amount) : acc.plus(r.amount)), ZERO);
  const verified = sum('VERIFIED');
  const pending = sum('PENDING');

  const due = booking.agencyFee;
  if (due == null || due.lte(ZERO)) {
    return {
      bookingId,
      currency: booking.currency,
      due,
      verified,
      pending,
      covered: false,
      reason: 'agency_fee_unset',
    };
  }
  const covered = verified.gte(due);
  return {
    bookingId,
    currency: booking.currency,
    due,
    verified,
    pending,
    covered,
    reason: covered ? 'covered' : 'short',
  };
}

/** The booking row, `FOR UPDATE`. The one lock every writer here takes first. */
export async function lockBooking(tx: TxClient, tenantId: string, bookingId: string) {
  const [row] = await tx.$queryRaw<
    { id: string; status: string; currency: string; agencyFee: Prisma.Decimal | null }[]
  >`
    SELECT "id", "status"::text AS status, "currency", "agencyFee"
    FROM "Booking"
    WHERE "id" = ${bookingId} AND "tenantId" = ${tenantId} AND "deletedAt" IS NULL
    FOR UPDATE
  `;
  if (!row) throw NotFound('Booking');
  return row;
}

/** Throws the reason a booking is not eligible, for the three places that gate money on it. */
export async function assertCovered(tx: TxClient, tenantId: string, bookingId: string, what: string) {
  const c = await coverage(tx, tenantId, bookingId);
  if (c.covered) return c;
  const message = {
    agency_fee_unset: `${what}: the booking has no agreed agency fee recorded, so nothing can be measured against it.`,
    short: `${what}: verified receipts cover ${c.verified.toFixed(2)} of the ${c.due?.toFixed(2)} ${c.currency} agency fee.`,
    currency_mismatch: `${what}: a receipt is in a different currency from the booking, and there is no conversion policy.`,
    covered: '',
  }[c.reason];
  throw Invalid([{ field: 'bookingId', code: `not_covered:${c.reason}`, message }]);
}

// ── Recording ────────────────────────────────────────────────────────────────

export interface RecordReceiptInput {
  ctx: Ctx;
  bookingId: string;
  amount: string | number;
  currency: string;
  paidAt: Date;
  paymentReference: string;
  providerTransactionRef?: string | null;
  evidenceDocumentId?: string | null;
  /** Client-chosen key; the same key with the same body returns the same receipt. */
  requestKey?: string | null;
}

export async function recordReceipt(input: RecordReceiptInput) {
  const { ctx } = input;
  const amount = D(input.amount);
  if (!amount.isFinite() || amount.lte(ZERO)) {
    throw Invalid([
      {
        field: 'amount',
        code: 'positive',
        message: 'A receipt records money that arrived: the amount must be positive.',
      },
    ]);
  }
  if (!input.providerTransactionRef && !input.evidenceDocumentId) {
    throw Invalid([
      {
        field: 'evidence',
        code: 'required',
        message:
          'A reference alone is not evidence. Attach the bank or payment-provider transaction id, or the receipt document.',
      },
    ]);
  }

  const idem = input.requestKey
    ? {
        tenantId: ctx.tenantId,
        operation: 'collections.receipt.record',
        requestKey: input.requestKey,
        actorUserId: ctx.actor.id,
        scopeRef: input.bookingId,
        input: {
          bookingId: input.bookingId,
          amount: amount.toFixed(2),
          currency: input.currency,
          paidAt: input.paidAt.toISOString(),
          paymentReference: input.paymentReference,
          providerTransactionRef: input.providerTransactionRef ?? null,
          evidenceDocumentId: input.evidenceDocumentId ?? null,
        },
      }
    : null;
  if (idem) {
    const replay = await findReplay<{ id: string; reference: string }>(idem);
    if (replay) return { receipt: replay.result, replayed: true as const };
  }

  return withTx(ctx.tenantId, async (tx) => {
    const booking = await lockBooking(tx, ctx.tenantId, input.bookingId);
    if (booking.status !== 'CONFIRMED') {
      throw Invalid([
        { field: 'bookingId', code: 'not_confirmed', message: 'Only a confirmed sale can receive money.' },
      ]);
    }
    if (input.currency !== booking.currency) {
      throw Invalid([
        {
          field: 'currency',
          code: 'mismatch',
          message: `This sale is in ${booking.currency}. There is no conversion policy, so a ${input.currency} receipt cannot be recorded against it.`,
        },
      ]);
    }
    if (input.evidenceDocumentId) {
      // Uploaded as evidence, clean, and for this booking — a document uploaded
      // for one sale cannot evidence money received on another.
      const doc = await tx.document.findFirst({
        where: {
          id: input.evidenceDocumentId,
          tenantId: ctx.tenantId,
          deletedAt: null,
          category: EVIDENCE_CATEGORY,
          scanState: 'CLEAN',
          storageKey: { startsWith: evidencePrefix(ctx.tenantId, booking.id) },
        },
        select: { id: true },
      });
      if (!doc) throw NotFound('Evidence document');
    }

    const reference = await nextReference(tx, ctx.tenantId, 'RECEIPT');
    const receipt = await tx.agencyFeeReceipt.create({
      data: {
        tenantId: ctx.tenantId,
        bookingId: booking.id,
        reference,
        kind: 'RECEIPT',
        status: 'PENDING',
        amount,
        currency: input.currency,
        paidAt: input.paidAt,
        paymentReference: input.paymentReference,
        providerTransactionRef: input.providerTransactionRef ?? null,
        evidenceDocumentId: input.evidenceDocumentId ?? null,
        recordedById: ctx.actor.id,
        updatedById: ctx.actor.id,
      },
    });

    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'collections',
        recordId: receipt.id,
        newValue: {
          reference,
          bookingId: booking.id,
          amount: amount.toFixed(2),
          currency: input.currency,
          paidAt: input.paidAt,
        },
      },
      tx,
    );
    if (idem) await recordOutcome(tx, idem, { id: receipt.id, reference });
    return { receipt, replayed: false as const };
  });
}

export interface ReverseReceiptInput {
  ctx: Ctx;
  receiptId: string;
  amount: string | number;
  reason: string;
  requestKey?: string | null;
}

/** A reversal is a new PENDING row pointing at a VERIFIED receipt; it counts only once verified by someone else. */
export async function reverseReceipt(input: ReverseReceiptInput) {
  const { ctx } = input;
  const amount = D(input.amount);
  if (!amount.isFinite() || amount.lte(ZERO)) {
    throw Invalid([
      { field: 'amount', code: 'positive', message: 'State how much is being reversed, as a positive amount.' },
    ]);
  }
  if (!input.reason || input.reason.trim().length < 4) {
    throw Invalid([{ field: 'reason', code: 'required', message: 'A reversal needs a reason a reviewer can read.' }]);
  }

  return withTx(ctx.tenantId, async (tx) => {
    const original = await tx.agencyFeeReceipt.findFirst({
      where: { id: input.receiptId, tenantId: ctx.tenantId },
    });
    if (!original) throw NotFound('Receipt');
    await lockBooking(tx, ctx.tenantId, original.bookingId);

    if (original.kind !== 'RECEIPT' || original.status !== 'VERIFIED') {
      throw Conflict('Only a verified receipt can be reversed. Reject a pending one instead.');
    }
    const already = await tx.agencyFeeReceipt.aggregate({
      where: { tenantId: ctx.tenantId, reversesId: original.id, status: { in: ['VERIFIED', 'PENDING'] } },
      _sum: { amount: true },
    });
    const remaining = original.amount.minus(already._sum.amount ?? ZERO);
    if (amount.gt(remaining)) {
      throw Invalid([
        {
          field: 'amount',
          code: 'exceeds',
          message: `Only ${remaining.toFixed(2)} ${original.currency} of ${original.reference} is still reversible.`,
        },
      ]);
    }

    const idem = input.requestKey
      ? {
          tenantId: ctx.tenantId,
          operation: 'collections.receipt.reverse',
          requestKey: input.requestKey,
          actorUserId: ctx.actor.id,
          scopeRef: original.id,
          input: { receiptId: original.id, amount: amount.toFixed(2), reason: input.reason },
        }
      : null;
    if (idem) {
      const replay = await findReplay<{ id: string; reference: string }>(idem);
      if (replay) return { receipt: replay.result, replayed: true as const };
    }

    const reference = await nextReference(tx, ctx.tenantId, 'RECEIPT');
    const reversal = await tx.agencyFeeReceipt.create({
      data: {
        tenantId: ctx.tenantId,
        bookingId: original.bookingId,
        reference,
        kind: 'REVERSAL',
        status: 'PENDING',
        amount,
        currency: original.currency,
        // The money moves back when the reversal is made, not when the original arrived.
        paidAt: new Date(),
        paymentReference: `REVERSAL OF ${original.reference}`,
        // The evidence is the original's; the reversal inherits the trace.
        providerTransactionRef: original.providerTransactionRef,
        evidenceDocumentId: original.evidenceDocumentId,
        reason: input.reason,
        reversesId: original.id,
        recordedById: ctx.actor.id,
        updatedById: ctx.actor.id,
      },
    });
    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'collections',
        recordId: reversal.id,
        newValue: { reference, reverses: original.reference, amount: amount.toFixed(2), reason: input.reason },
      },
      tx,
    );
    if (idem) await recordOutcome(tx, idem, { id: reversal.id, reference });
    return { receipt: reversal, replayed: false as const };
  });
}

// ── Verification ─────────────────────────────────────────────────────────────

export interface DecideReceiptInput {
  ctx: Ctx;
  receiptId: string;
  to: 'VERIFIED' | 'REJECTED';
  reason?: string;
}

export async function decideReceipt(input: DecideReceiptInput) {
  const { ctx } = input;
  if (input.to === 'REJECTED' && !(input.reason && input.reason.trim().length >= 4)) {
    throw Invalid([{ field: 'reason', code: 'required', message: 'Say why it is rejected.' }]);
  }

  return withTx(ctx.tenantId, async (tx) => {
    const first = await tx.agencyFeeReceipt.findFirst({
      where: { id: input.receiptId, tenantId: ctx.tenantId },
      select: { id: true, bookingId: true },
    });
    if (!first) throw NotFound('Receipt');

    // Booking first, then the receipt: the same order as a payout approval,
    // so a reversal and an approval on the same booking cannot interleave.
    await lockBooking(tx, ctx.tenantId, first.bookingId);
    const [receipt] = await tx.$queryRaw<
      { id: string; status: string; kind: string; recordedById: string; amount: Prisma.Decimal; reference: string }[]
    >`
      SELECT "id", "status"::text AS status, "kind"::text AS kind, "recordedById", "amount", "reference"
      FROM "AgencyFeeReceipt"
      WHERE "id" = ${first.id} AND "tenantId" = ${ctx.tenantId}
      FOR UPDATE
    `;
    if (!receipt) throw NotFound('Receipt');

    // D-8.2. Not "unless you are an administrator": the whole control is that
    // a second person looked.
    if (receipt.recordedById === ctx.actor.id) {
      throw Forbidden('You recorded this receipt. Someone else has to verify it.');
    }
    if (receipt.status !== 'PENDING') {
      throw Conflict(`This receipt is already ${receipt.status.toLowerCase()}.`);
    }

    const now = new Date();
    const updated = await tx.agencyFeeReceipt.update({
      where: { id: receipt.id, tenantId: ctx.tenantId },
      data:
        input.to === 'VERIFIED'
          ? { status: 'VERIFIED', verifiedById: ctx.actor.id, verifiedAt: now, updatedById: ctx.actor.id }
          : {
              status: 'REJECTED',
              rejectedById: ctx.actor.id,
              rejectedAt: now,
              reason: input.reason,
              updatedById: ctx.actor.id,
            },
    });
    await audit(
      ctx,
      {
        event: 'STAGE_CHANGED',
        objectType: 'collections',
        recordId: receipt.id,
        previousValue: { status: 'PENDING' },
        newValue: { status: input.to, reason: input.reason ?? null, reference: receipt.reference },
      },
      tx,
    );

    // A verified reversal is the one event that can take money *out* of
    // coverage, so it is the one event that re-evaluates what that money had
    // already permitted.
    const consequences =
      input.to === 'VERIFIED' && receipt.kind === 'REVERSAL'
        ? await reevaluateCoverage(tx, ctx, first.bookingId, {
            receiptId: receipt.id,
            why: `receipt ${receipt.reference} reversed`,
          })
        : { regressed: [] as string[], detachedFromPayouts: [] as string[], recoveryCases: [] as string[] };

    return { receipt: updated, ...consequences };
  });
}

/**
 * Coverage has gone down — a verified reversal, or an approved fee amendment
 * that raised the bar. Unpaid commission loses its eligibility and leaves its
 * payout; paid commission opens a case for finance. The booking row is
 * already locked by the caller.
 */
export interface CoverageCause {
  receiptId?: string;
  amendmentId?: string;
  why: string;
}

export async function reevaluateCoverage(tx: TxClient, ctx: Ctx, bookingId: string, cause: CoverageCause) {
  const c = await coverage(tx, ctx.tenantId, bookingId);
  const result = { regressed: [] as string[], detachedFromPayouts: [] as string[], recoveryCases: [] as string[] };
  if (c.covered) return result;

  const shortfall = (c.due ?? ZERO).minus(c.verified);
  const affected = await tx.commission.findMany({
    where: { tenantId: ctx.tenantId, bookingId, status: { in: ['COLLECTED', 'PAID'] }, reversesId: null },
    include: { payout: { select: { id: true, status: true, note: true } } },
  });

  for (const commission of affected) {
    if (commission.status === 'PAID') {
      const kase = await tx.collectionRecoveryCase.create({
        data: {
          tenantId: ctx.tenantId,
          bookingId,
          commissionId: commission.id,
          payoutId: commission.payoutId,
          kind: cause.amendmentId ? 'FEE_AMENDMENT' : 'RECEIPT_REVERSAL',
          receiptId: cause.receiptId ?? null,
          amendmentId: cause.amendmentId ?? null,
          shortfall: shortfall.gt(ZERO) ? shortfall : ZERO.plus('0.01'),
          currency: c.currency,
          reason: `Coverage fell after payment (${cause.why}): verified receipts now cover ${c.verified.toFixed(2)} of ${c.due?.toFixed(2)} ${c.currency}.`,
          createdById: ctx.actor.id,
        },
      });
      result.recoveryCases.push(kase.id);
      await audit(
        ctx,
        {
          event: 'RECORD_CREATED',
          objectType: 'collection_recovery',
          recordId: kase.id,
          newValue: { commissionId: commission.id, shortfall: shortfall.toFixed(2), cause: cause.why },
        },
        tx,
      );
      continue;
    }

    // COLLECTED but not paid: eligibility is withdrawn, and the run it sat in
    // no longer adds up. Detach, re-total, and reopen an approved run — an
    // approval given for a different total is not an approval of this one.
    await tx.commission.update({
      where: { id: commission.id, tenantId: ctx.tenantId },
      data: { status: 'CONFIRMED', collectedAt: null, payoutId: null, updatedById: ctx.actor.id },
    });
    result.regressed.push(commission.id);
    await audit(
      ctx,
      {
        event: 'STAGE_CHANGED',
        objectType: 'commissions',
        recordId: commission.id,
        previousValue: { status: 'COLLECTED', payoutId: commission.payoutId },
        newValue: { status: 'CONFIRMED', payoutId: null, reason: cause.why },
      },
      tx,
    );

    if (commission.payout && commission.payout.status !== 'PAID' && commission.payout.status !== 'CANCELLED') {
      const rows = await tx.commission.findMany({
        where: { tenantId: ctx.tenantId, payoutId: commission.payout.id },
        select: { amount: true },
      });
      const total = rows.reduce((sum, r) => sum.plus(r.amount), ZERO);
      const note = `${commission.payout.note ? commission.payout.note + ' | ' : ''}Reopened: ${cause.why}; commission ${commission.id} removed.`;
      await tx.payout.update({
        where: { id: commission.payout.id, tenantId: ctx.tenantId },
        data: {
          totalAmount: total,
          ...(commission.payout.status === 'APPROVED' ? { status: 'DRAFT', approvedById: null, approvedAt: null } : {}),
          note,
        },
      });
      result.detachedFromPayouts.push(commission.payout.id);
    }
  }
  return result;
}

// ── Reading ──────────────────────────────────────────────────────────────────

export async function listReceipts(ctx: Ctx, bookingId: string) {
  return withTx(ctx.tenantId, async (tx) => {
    const c = await coverage(tx, ctx.tenantId, bookingId);
    const receipts = await tx.agencyFeeReceipt.findMany({
      where: { tenantId: ctx.tenantId, bookingId },
      orderBy: { createdAt: 'asc' },
    });
    return { coverage: c, receipts };
  });
}
