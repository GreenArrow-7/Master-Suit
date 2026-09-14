/**
 * The agreed agency fee, as a controlled commercial term (D-20).
 *
 * A commercial administrator proposes the fee or a change to it, with a
 * reason and the agreement it rests on. Before the sale is confirmed that is
 * the whole story — nothing has accrued against the fee yet. After
 * confirmation a different person from finance approves, and approval is
 * where the effect lands:
 *
 *   - `Booking.agencyFee` changes; the previous value stays on this row.
 *   - Unpaid commission that was computed *on the fee* is recalculated from
 *     the bands frozen on it at accrual. Nothing is re-read from today's slab.
 *     Where the frozen bands cannot answer — a fee that has climbed past the
 *     last band they recorded — the amount is left alone and a case is opened
 *     instead, because the alternative is inventing a number.
 *   - An approved payout containing any recalculated line goes back to DRAFT:
 *     an approval given for a different total is not an approval of this one.
 *   - Paid commission is never rewritten. A recovery/adjustment case is opened
 *     with the signed difference for finance to review.
 *   - Coverage is re-evaluated: a higher fee can take a covered booking below
 *     the line, and that has the same consequences as a reversal.
 *
 * Every write here takes the booking row first — the lock every payout gate
 * takes — so an amendment cannot pass a payout approval or payment in flight.
 */
import { Prisma } from '@prisma/client';
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { withTx, type TxClient } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { nextReference } from '@/services/shared/reference';
import { assertBookingInScope, coverage, lockBooking, reevaluateCoverage, ZERO, type Coverage } from './collections';

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);
const money = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

interface FrozenBand {
  from: string;
  to: string | null;
  portion: string;
  ratePct: string | null;
  amount: string;
}

/**
 * The commission's amount under a new base, using only what was frozen on it.
 *
 * Returns null when the frozen bands cannot cover the new base — the honest
 * answer, handed to a human as a case rather than guessed.
 */
export function recomputeFromFrozen(
  commission: { slabMode: string | null; slabBasis: string | null; sharePct: Prisma.Decimal; calculation: unknown },
  newBase: Prisma.Decimal,
): { gross: Prisma.Decimal; amount: Prisma.Decimal; breakdown: FrozenBand[] } | null {
  const calc = (commission.calculation ?? {}) as { bands?: FrozenBand[] };
  const bands = (calc.bands ?? []).map((b) => ({ ...b, fromD: D(b.from), toD: b.to === null ? null : D(b.to) }));
  if (bands.length === 0) return null;
  const last = bands[bands.length - 1];
  // Beyond the last frozen band there is no rate we know to be the agreement.
  if (last.toD !== null && newBase.gt(last.toD)) return null;
  if (newBase.lt(bands[0].fromD)) return null;

  if (commission.slabMode === 'FLAT') {
    const band = bands.find((b) => newBase.gte(b.fromD) && (b.toD === null || newBase.lt(b.toD))) ?? last;
    if (band.ratePct === null) return null;
    const gross = money(newBase.times(D(band.ratePct)).div(100));
    return {
      gross,
      amount: money(gross.times(commission.sharePct).div(100)),
      breakdown: [
        { from: band.from, to: band.to, portion: newBase.toString(), ratePct: band.ratePct, amount: gross.toString() },
      ],
    };
  }

  // PROGRESSIVE: each frozen band on its own slice, rounded as it goes.
  let gross = ZERO;
  const breakdown: FrozenBand[] = [];
  for (const b of bands) {
    if (newBase.lte(b.fromD)) break;
    if (b.ratePct === null) return null;
    const upper = b.toD === null ? newBase : Prisma.Decimal.min(newBase, b.toD);
    const portion = upper.minus(b.fromD);
    const slice = money(portion.times(D(b.ratePct)).div(100));
    gross = gross.plus(slice);
    breakdown.push({
      from: b.from,
      to: b.to,
      portion: portion.toString(),
      ratePct: b.ratePct,
      amount: slice.toString(),
    });
  }
  return { gross, amount: money(gross.times(commission.sharePct).div(100)), breakdown };
}

export interface AmendmentPreview {
  bookingId: string;
  currency: string;
  previousFee: string | null;
  proposedFee: string;
  coverageBefore: { verified: string; covered: boolean; reason: string };
  coverageAfter: { verified: string; covered: boolean; reason: string };
  commissions: {
    id: string;
    userId: string;
    status: string;
    basis: string | null;
    affected: boolean;
    currentAmount: string;
    newAmount: string | null;
    action: 'unchanged' | 'recalculate' | 'case' | 'case:frozen-bands-exhausted';
  }[];
  payoutsToReopen: { id: string; reference: string; status: string }[];
}

/** What approval would do, computed read-only. Called at proposal and again under the lock at approval. */
export async function previewAmendment(
  tx: TxClient,
  tenantId: string,
  bookingId: string,
  proposedFee: Prisma.Decimal,
): Promise<AmendmentPreview> {
  const booking = await tx.booking.findFirst({
    where: { id: bookingId, tenantId, deletedAt: null },
    select: { id: true, agencyFee: true, currency: true },
  });
  if (!booking) throw NotFound('Booking');
  const before: Coverage = await coverage(tx, tenantId, bookingId);
  const after =
    before.covered || before.reason === 'short' || before.reason === 'agency_fee_unset'
      ? {
          verified: before.verified,
          covered: before.verified.gte(proposedFee),
          reason: before.verified.gte(proposedFee) ? 'covered' : 'short',
        }
      : { verified: before.verified, covered: false, reason: before.reason };

  const commissions = await tx.commission.findMany({
    where: { tenantId, bookingId, reversesId: null },
    include: { payout: { select: { id: true, reference: true, status: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const payouts = new Map<string, { id: string; reference: string; status: string }>();
  const lines = commissions.map((c) => {
    const affected = c.slabBasis === 'PERCENT_OF_AGENCY_FEE' && c.status !== 'CLAWED_BACK';
    if (!affected) {
      return {
        id: c.id,
        userId: c.userId,
        status: c.status,
        basis: c.slabBasis,
        affected: false,
        currentAmount: c.amount.toString(),
        newAmount: c.amount.toString(),
        action: 'unchanged' as const,
      };
    }
    const recomputed = recomputeFromFrozen(c, proposedFee);
    if (c.status === 'PAID') {
      return {
        id: c.id,
        userId: c.userId,
        status: c.status,
        basis: c.slabBasis,
        affected: true,
        currentAmount: c.amount.toString(),
        newAmount: recomputed?.amount.toString() ?? null,
        action: 'case' as const,
      };
    }
    if (!recomputed) {
      return {
        id: c.id,
        userId: c.userId,
        status: c.status,
        basis: c.slabBasis,
        affected: true,
        currentAmount: c.amount.toString(),
        newAmount: null,
        action: 'case:frozen-bands-exhausted' as const,
      };
    }
    if (c.payout && (c.payout.status === 'DRAFT' || c.payout.status === 'APPROVED')) payouts.set(c.payout.id, c.payout);
    return {
      id: c.id,
      userId: c.userId,
      status: c.status,
      basis: c.slabBasis,
      affected: true,
      currentAmount: c.amount.toString(),
      newAmount: recomputed.amount.toString(),
      action: 'recalculate' as const,
    };
  });

  return {
    bookingId,
    currency: booking.currency,
    previousFee: booking.agencyFee?.toString() ?? null,
    proposedFee: proposedFee.toString(),
    coverageBefore: { verified: before.verified.toString(), covered: before.covered, reason: before.reason },
    coverageAfter: { verified: after.verified.toString(), covered: after.covered, reason: after.reason },
    commissions: lines,
    payoutsToReopen: [...payouts.values()],
  };
}

export interface ProposeInput {
  ctx: Ctx;
  bookingId: string;
  proposedFee: string | number;
  reason: string;
  agreementReference: string;
}

export async function proposeAmendment(input: ProposeInput) {
  const { ctx } = input;
  const proposedFee = D(input.proposedFee);
  if (!proposedFee.isFinite() || proposedFee.lte(ZERO)) {
    throw Invalid([
      {
        field: 'proposedFee',
        code: 'positive',
        message:
          'The agreed agency fee must be a positive amount. A zero fee does not qualify anything and is not something this workflow can record.',
      },
    ]);
  }
  if (input.reason.trim().length < 4)
    throw Invalid([{ field: 'reason', code: 'required', message: 'Say why the fee is changing.' }]);
  if (input.agreementReference.trim().length < 2) {
    throw Invalid([
      { field: 'agreementReference', code: 'required', message: 'Name the agreement or reference the fee rests on.' },
    ]);
  }

  return withTx(ctx.tenantId, async (tx) => {
    await assertBookingInScope(tx, ctx, 'agencyfee', 'CREATE', input.bookingId);
    const booking = await lockBooking(tx, ctx.tenantId, input.bookingId);
    if (booking.agencyFee && booking.agencyFee.equals(proposedFee)) {
      throw Conflict('That is already the agreed fee.');
    }
    const open = await tx.agencyFeeAmendment.findFirst({
      where: { tenantId: ctx.tenantId, bookingId: booking.id, status: 'PENDING' },
      select: { reference: true },
    });
    if (open) throw Conflict(`${open.reference} is still waiting for a decision on this booking.`);

    const preview = await previewAmendment(tx, ctx.tenantId, booking.id, proposedFee);
    const reference = await nextReference(tx, ctx.tenantId, 'FEE_AMENDMENT');

    // Before confirmation nothing has accrued and nobody has been paid on the
    // fee, so the proposer's own authority is enough: applied at once,
    // recorded as such, no approver — and the row says why.
    const preConfirmation = booking.status === 'DRAFT';
    const now = new Date();
    const amendment = await tx.agencyFeeAmendment.create({
      data: {
        tenantId: ctx.tenantId,
        bookingId: booking.id,
        reference,
        status: preConfirmation ? 'APPROVED' : 'PENDING',
        previousFee: booking.agencyFee,
        proposedFee,
        currency: booking.currency,
        reason: input.reason.trim(),
        agreementReference: input.agreementReference.trim(),
        preview: preview as unknown as Prisma.InputJsonValue,
        proposedById: ctx.actor.id,
        ...(preConfirmation
          ? {
              decidedAt: now,
              decisionNote:
                'Applied before confirmation: nothing had accrued, so no finance approval is required (D-20).',
              appliedAt: now,
            }
          : {}),
      },
    });
    if (preConfirmation) {
      await tx.booking.update({
        where: { id: booking.id, tenantId: ctx.tenantId },
        data: { agencyFee: proposedFee, updatedById: ctx.actor.id },
      });
    }
    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'agencyfee',
        recordId: amendment.id,
        previousValue: { agencyFee: booking.agencyFee?.toString() ?? null },
        newValue: {
          reference,
          proposedFee: proposedFee.toString(),
          reason: amendment.reason,
          agreementReference: amendment.agreementReference,
          status: amendment.status,
        },
      },
      tx,
    );
    return { amendment, preview };
  });
}

export interface DecideInput {
  ctx: Ctx;
  amendmentId: string;
  to: 'APPROVED' | 'REJECTED';
  note?: string;
}

export async function decideAmendment(input: DecideInput) {
  const { ctx } = input;
  if (input.to === 'REJECTED' && !(input.note && input.note.trim().length >= 4)) {
    throw Invalid([{ field: 'note', code: 'required', message: 'Say why it is rejected.' }]);
  }

  return withTx(ctx.tenantId, async (tx) => {
    const first = await tx.agencyFeeAmendment.findFirst({
      where: { id: input.amendmentId, tenantId: ctx.tenantId },
      select: { id: true, bookingId: true },
    });
    if (!first) throw NotFound('Amendment');
    await assertBookingInScope(tx, ctx, 'agencyfee', 'APPROVE', first.bookingId, 'Amendment');

    // Booking first — the same lock a payout approval, a payment and a receipt
    // decision take — then the amendment row.
    const booking = await lockBooking(tx, ctx.tenantId, first.bookingId);
    const [amendment] = await tx.$queryRaw<
      {
        id: string;
        status: string;
        proposedById: string;
        proposedFee: Prisma.Decimal;
        reference: string;
        currency: string;
      }[]
    >`
      SELECT "id", "status"::text AS status, "proposedById", "proposedFee", "reference", "currency"
      FROM "AgencyFeeAmendment" WHERE "id" = ${first.id} AND "tenantId" = ${ctx.tenantId} FOR UPDATE
    `;
    if (!amendment) throw NotFound('Amendment');
    if (amendment.proposedById === ctx.actor.id) {
      throw Forbidden('You proposed this amendment. Someone else has to decide it.');
    }
    if (amendment.status !== 'PENDING') throw Conflict(`This amendment is already ${amendment.status.toLowerCase()}.`);
    if (amendment.currency !== booking.currency) {
      throw Conflict(
        'The booking currency has changed since this was proposed. Currency corrections are a separate process.',
      );
    }

    const now = new Date();
    if (input.to === 'REJECTED') {
      const rejected = await tx.agencyFeeAmendment.update({
        where: { id: amendment.id, tenantId: ctx.tenantId },
        data: { status: 'REJECTED', decidedById: ctx.actor.id, decidedAt: now, decisionNote: input.note },
      });
      await audit(
        ctx,
        {
          event: 'STAGE_CHANGED',
          objectType: 'agencyfee',
          recordId: amendment.id,
          previousValue: { status: 'PENDING' },
          newValue: { status: 'REJECTED', note: input.note },
        },
        tx,
      );
      return { amendment: rejected, applied: null };
    }

    // The preview again, under the lock: the ledger may have moved since the
    // proposal, and what is applied is what is true now.
    const proposedFee = D(amendment.proposedFee);
    const preview = await previewAmendment(tx, ctx.tenantId, booking.id, proposedFee);
    const previousFee = booking.agencyFee;

    await tx.booking.update({
      where: { id: booking.id, tenantId: ctx.tenantId },
      data: { agencyFee: proposedFee, updatedById: ctx.actor.id },
    });

    const recalculated: string[] = [];
    const cases: string[] = [];
    const reopened = new Set<string>();
    for (const line of preview.commissions) {
      if (!line.affected) continue;
      const commission = await tx.commission.findFirstOrThrow({
        where: { id: line.id, tenantId: ctx.tenantId },
        include: { payout: true },
      });

      if (line.action === 'recalculate' && line.newAmount !== null) {
        const recomputed = recomputeFromFrozen(commission, proposedFee)!;
        const calc = (commission.calculation ?? {}) as Record<string, unknown>;
        const trail = Array.isArray(calc.amendments) ? (calc.amendments as unknown[]) : [];
        await tx.commission.update({
          where: { id: commission.id, tenantId: ctx.tenantId },
          data: {
            baseAmount: proposedFee,
            amount: recomputed.amount,
            calculation: {
              ...calc,
              base: proposedFee.toString(),
              gross: recomputed.gross.toString(),
              bands: recomputed.breakdown,
              amendments: [
                ...trail,
                {
                  amendmentId: amendment.id,
                  reference: amendment.reference,
                  at: now.toISOString(),
                  previousBase: commission.baseAmount.toString(),
                  previousAmount: commission.amount.toString(),
                  newAmount: recomputed.amount.toString(),
                },
              ],
            } as unknown as Prisma.InputJsonValue,
            updatedById: ctx.actor.id,
          },
        });
        recalculated.push(commission.id);
        await audit(
          ctx,
          {
            event: 'RECORD_UPDATED',
            objectType: 'commissions',
            recordId: commission.id,
            fieldKey: 'amount',
            previousValue: { amount: commission.amount.toString(), baseAmount: commission.baseAmount.toString() },
            newValue: {
              amount: recomputed.amount.toString(),
              baseAmount: proposedFee.toString(),
              amendment: amendment.reference,
            },
          },
          tx,
        );

        if (commission.payout && (commission.payout.status === 'DRAFT' || commission.payout.status === 'APPROVED')) {
          const rows = await tx.commission.findMany({
            where: { tenantId: ctx.tenantId, payoutId: commission.payout.id },
            select: { amount: true },
          });
          const total = rows.reduce((sum, r) => sum.plus(r.amount), ZERO);
          await tx.payout.update({
            where: { id: commission.payout.id, tenantId: ctx.tenantId },
            data: {
              totalAmount: total,
              ...(commission.payout.status === 'APPROVED'
                ? { status: 'DRAFT', approvedById: null, approvedAt: null }
                : {}),
              note: `${commission.payout.note ? commission.payout.note + ' | ' : ''}Reopened: agency fee amended (${amendment.reference}); commission ${commission.id} recalculated.`,
            },
          });
          reopened.add(commission.payout.id);
        }
        continue;
      }

      // PAID, or frozen bands cannot answer: a case with the numbers, no write
      // to the commission.
      const delta = line.newAmount === null ? null : D(line.newAmount).minus(commission.amount);
      const kase = await tx.collectionRecoveryCase.create({
        data: {
          tenantId: ctx.tenantId,
          bookingId: booking.id,
          commissionId: commission.id,
          payoutId: commission.payoutId,
          kind: 'FEE_AMENDMENT',
          amendmentId: amendment.id,
          adjustment: delta,
          currency: booking.currency,
          reason:
            line.action === 'case'
              ? `Agency fee amended (${amendment.reference}) after this commission was paid: ${commission.amount.toFixed(2)} paid, ${line.newAmount} due under the amended fee.`
              : `Agency fee amended (${amendment.reference}) beyond the bands frozen on this commission; the agreement cannot be applied mechanically. Review by hand.`,
          createdById: ctx.actor.id,
        },
      });
      cases.push(kase.id);
      await audit(
        ctx,
        {
          event: 'RECORD_CREATED',
          objectType: 'collection_recovery',
          recordId: kase.id,
          newValue: {
            commissionId: commission.id,
            amendment: amendment.reference,
            adjustment: delta?.toString() ?? null,
          },
        },
        tx,
      );
    }

    const approved = await tx.agencyFeeAmendment.update({
      where: { id: amendment.id, tenantId: ctx.tenantId },
      data: {
        status: 'APPROVED',
        decidedById: ctx.actor.id,
        decidedAt: now,
        decisionNote: input.note,
        appliedAt: now,
        preview: {
          ...preview,
          appliedAt: now.toISOString(),
          recalculated,
          cases,
          reopened: [...reopened],
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await audit(
      ctx,
      {
        event: 'STAGE_CHANGED',
        objectType: 'agencyfee',
        recordId: amendment.id,
        previousValue: { status: 'PENDING', agencyFee: previousFee?.toString() ?? null },
        newValue: {
          status: 'APPROVED',
          agencyFee: proposedFee.toString(),
          recalculated,
          cases,
          reopened: [...reopened],
        },
      },
      tx,
    );

    // A higher fee can uncover a booking that was covered. Same consequences as
    // a reversal, same code path.
    const consequences = await reevaluateCoverage(tx, ctx, booking.id, {
      amendmentId: amendment.id,
      why: `agency fee amended (${amendment.reference})`,
    });

    return {
      amendment: approved,
      applied: {
        recalculated,
        cases: [...cases, ...consequences.recoveryCases],
        reopened: [...new Set([...reopened, ...consequences.detachedFromPayouts])],
        regressed: consequences.regressed,
      },
    };
  });
}

export async function listAmendments(ctx: Ctx, bookingId: string) {
  return withTx(ctx.tenantId, async (tx) => {
    await assertBookingInScope(tx, ctx, 'agencyfee', 'VIEW', bookingId);
    return tx.agencyFeeAmendment.findMany({
      where: { tenantId: ctx.tenantId, bookingId },
      orderBy: { createdAt: 'desc' },
    });
  });
}
