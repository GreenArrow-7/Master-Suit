/**
 * Recovery and adjustment cases: what finance does with them.
 *
 * A case is opened by the system when money that was already paid out turns
 * out to rest on less than it did — a verified reversal, or an approved fee
 * amendment. It is never resolved by the system. The workflow:
 *
 *   assign        somebody owns it (collections:CREATE)
 *   acknowledge   somebody has looked (collections:CREATE) — this is NOT
 *                 recovery and moves no money; the case stays open
 *   recover       money came back, with evidence: an amount, a reference and
 *                 a provider/bank transaction id or a document (collections:CREATE)
 *   propose       write off, or accept the adjustment, with a reason (collections:CREATE)
 *   approve       a *different* person agrees (collections:APPROVE) — the only
 *                 way a case ends without evidence of money
 *
 * Nothing here debits anyone, rewrites a payout, or changes a paid
 * commission. The case records the decision; the ledger keeps its history.
 */
import { Prisma } from '@prisma/client';
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { withTx, type TxClient } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import type { Action, Ctx } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';
import { assertBookingInScope, assertEvidenceFor } from './collections';

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

/** The case row `FOR UPDATE`, if the actor's collections scope reaches its sale; otherwise not found. */
async function lockCase(tx: TxClient, ctx: Ctx, id: string, action: Action = 'CREATE') {
  const tenantId = ctx.tenantId;
  const [row] = await tx.$queryRaw<
    {
      id: string;
      bookingId: string;
      status: string;
      kind: string;
      proposedById: string | null;
      proposedOutcome: string | null;
      currency: string;
      shortfall: Prisma.Decimal | null;
      adjustment: Prisma.Decimal | null;
    }[]
  >`
    SELECT "id", "bookingId", "status"::text AS status, "kind"::text AS kind, "proposedById", "proposedOutcome"::text AS "proposedOutcome",
           "currency", "shortfall", "adjustment"
    FROM "CollectionRecoveryCase" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE
  `;
  if (!row) throw NotFound('Recovery case');
  await assertBookingInScope(tx, ctx, 'collections', action, row.bookingId, 'Recovery case');
  return row;
}

export async function listCases(ctx: Ctx, filter: { status?: string; assigneeId?: string } = {}) {
  // Resolved before the transaction: the scope lookup must not run on the
  // transaction's connection through the global client (see visibility.ts).
  const booking = await visibilityWhere(ctx, 'collections', 'VIEW');
  return withTx(ctx.tenantId, (tx) =>
    tx.collectionRecoveryCase.findMany({
      where: {
        tenantId: ctx.tenantId,
        booking,
        ...(filter.status ? { status: filter.status as never } : {}),
        ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        booking: { select: { id: true, reference: true, ownerId: true } },
        commission: { select: { id: true, userId: true, amount: true, status: true, currency: true } },
        receipt: { select: { id: true, reference: true, amount: true, reason: true } },
        amendment: { select: { id: true, reference: true, previousFee: true, proposedFee: true } },
      },
    }),
  );
}

export async function assignCase(input: { ctx: Ctx; caseId: string; assigneeId: string }) {
  const { ctx } = input;
  return withTx(ctx.tenantId, async (tx) => {
    const row = await lockCase(tx, ctx, input.caseId);
    if (row.status === 'RESOLVED') throw Conflict('This case is resolved.');
    const assignee = await tx.user.findFirst({
      where: { id: input.assigneeId, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!assignee) throw NotFound('Assignee');
    const updated = await tx.collectionRecoveryCase.update({
      where: { id: row.id, tenantId: ctx.tenantId },
      data: { assigneeId: assignee.id },
    });
    await audit(
      ctx,
      {
        event: 'OWNER_CHANGED',
        objectType: 'collection_recovery',
        recordId: row.id,
        newValue: { assigneeId: assignee.id },
      },
      tx,
    );
    return updated;
  });
}

/** Somebody has looked. The case stays open; no money moved. */
export async function acknowledgeCase(input: { ctx: Ctx; caseId: string; note: string }) {
  const { ctx } = input;
  if (input.note.trim().length < 4)
    throw Invalid([{ field: 'note', code: 'required', message: 'Say what was found.' }]);
  return withTx(ctx.tenantId, async (tx) => {
    const row = await lockCase(tx, ctx, input.caseId);
    if (row.status !== 'OPEN') throw Conflict(`This case is ${row.status.toLowerCase().replace('_', ' ')}, not open.`);
    const updated = await tx.collectionRecoveryCase.update({
      where: { id: row.id, tenantId: ctx.tenantId },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedById: ctx.actor.id,
        acknowledgedAt: new Date(),
        resolutionNote: input.note.trim(),
      },
    });
    await audit(
      ctx,
      {
        event: 'STAGE_CHANGED',
        objectType: 'collection_recovery',
        recordId: row.id,
        previousValue: { status: 'OPEN' },
        newValue: { status: 'ACKNOWLEDGED', note: input.note },
      },
      tx,
    );
    return updated;
  });
}

export interface RecordRecoveryInput {
  ctx: Ctx;
  caseId: string;
  recoveredAmount: string | number;
  resolutionReference: string;
  providerTransactionRef?: string | null;
  evidenceDocumentId?: string | null;
  note?: string;
}

/** Money came back. Evidence or it did not happen. */
export async function recordRecovery(input: RecordRecoveryInput) {
  const { ctx } = input;
  const amount = D(input.recoveredAmount);
  if (!amount.isFinite() || amount.lte(0))
    throw Invalid([
      { field: 'recoveredAmount', code: 'positive', message: 'How much came back, as a positive amount.' },
    ]);
  if (input.resolutionReference.trim().length < 2)
    throw Invalid([
      { field: 'resolutionReference', code: 'required', message: 'The reference the recovery can be found under.' },
    ]);
  if (!input.providerTransactionRef && !input.evidenceDocumentId) {
    throw Invalid([
      {
        field: 'evidence',
        code: 'required',
        message: 'A recovery is money with evidence: a bank or provider transaction id, or a document.',
      },
    ]);
  }
  return withTx(ctx.tenantId, async (tx) => {
    const row = await lockCase(tx, ctx, input.caseId);
    if (row.status === 'RESOLVED') throw Conflict('This case is resolved.');
    // The screen offers no recovery while a write-off or adjustment waits for a
    // second person; neither does this. Decline the proposal first.
    if (row.status === 'RESOLUTION_PROPOSED') throw Conflict('A resolution is waiting for approval.');
    // The same test a receipt's evidence passes, against the case's own sale.
    if (input.evidenceDocumentId) await assertEvidenceFor(tx, ctx.tenantId, row.bookingId, input.evidenceDocumentId);
    const updated = await tx.collectionRecoveryCase.update({
      where: { id: row.id, tenantId: ctx.tenantId },
      data: {
        status: 'RESOLVED',
        outcome: 'RECOVERED',
        recoveredAmount: amount,
        resolutionReference: input.resolutionReference.trim(),
        providerTransactionRef: input.providerTransactionRef ?? null,
        evidenceDocumentId: input.evidenceDocumentId ?? null,
        resolvedById: ctx.actor.id,
        resolvedAt: new Date(),
        resolutionNote: input.note?.trim() || null,
      },
    });
    await audit(
      ctx,
      {
        event: 'STAGE_CHANGED',
        objectType: 'collection_recovery',
        recordId: row.id,
        previousValue: { status: row.status },
        newValue: {
          status: 'RESOLVED',
          outcome: 'RECOVERED',
          recoveredAmount: amount.toFixed(2),
          reference: input.resolutionReference,
          providerTransactionRef: input.providerTransactionRef ?? null,
          evidenceDocumentId: input.evidenceDocumentId ?? null,
        },
      },
      tx,
    );
    return updated;
  });
}

/** A write-off or an accepted adjustment: proposed by one person, approved by another. */
export async function proposeResolution(input: {
  ctx: Ctx;
  caseId: string;
  outcome: 'WRITTEN_OFF' | 'ADJUSTED';
  reason: string;
}) {
  const { ctx } = input;
  if (input.reason.trim().length < 4)
    throw Invalid([{ field: 'reason', code: 'required', message: 'Say why the money is not being recovered.' }]);
  return withTx(ctx.tenantId, async (tx) => {
    const row = await lockCase(tx, ctx, input.caseId);
    if (row.status === 'RESOLVED') throw Conflict('This case is resolved.');
    if (row.status === 'RESOLUTION_PROPOSED') throw Conflict('A resolution is already waiting for approval.');
    if (input.outcome === 'ADJUSTED' && row.kind !== 'FEE_AMENDMENT') {
      throw Invalid([
        {
          field: 'outcome',
          code: 'kind',
          message:
            'Only a fee-amendment case can be closed as an adjustment; a reversal case is recovered or written off.',
        },
      ]);
    }
    const updated = await tx.collectionRecoveryCase.update({
      where: { id: row.id, tenantId: ctx.tenantId },
      data: {
        status: 'RESOLUTION_PROPOSED',
        proposedOutcome: input.outcome,
        proposedById: ctx.actor.id,
        proposedAt: new Date(),
        proposalReason: input.reason.trim(),
      },
    });
    await audit(
      ctx,
      {
        event: 'STAGE_CHANGED',
        objectType: 'collection_recovery',
        recordId: row.id,
        previousValue: { status: row.status },
        newValue: { status: 'RESOLUTION_PROPOSED', proposedOutcome: input.outcome, reason: input.reason },
      },
      tx,
    );
    return updated;
  });
}

export async function decideResolution(input: { ctx: Ctx; caseId: string; approve: boolean; note?: string }) {
  const { ctx } = input;
  return withTx(ctx.tenantId, async (tx) => {
    const row = await lockCase(tx, ctx, input.caseId, 'APPROVE');
    if (row.status !== 'RESOLUTION_PROPOSED' || !row.proposedOutcome)
      throw Conflict('Nothing is waiting for approval on this case.');
    if (row.proposedById === ctx.actor.id)
      throw Forbidden('You proposed this resolution. Someone else has to approve it.');
    const now = new Date();
    const updated = input.approve
      ? await tx.collectionRecoveryCase.update({
          where: { id: row.id, tenantId: ctx.tenantId },
          data: {
            status: 'RESOLVED',
            outcome: row.proposedOutcome as never,
            approvedById: ctx.actor.id,
            approvedAt: now,
            resolvedById: ctx.actor.id,
            resolvedAt: now,
            resolutionNote: input.note?.trim() || null,
          },
        })
      : await tx.collectionRecoveryCase.update({
          where: { id: row.id, tenantId: ctx.tenantId },
          data: {
            status: 'ACKNOWLEDGED',
            proposedOutcome: null,
            proposedById: null,
            proposedAt: null,
            proposalReason: null,
            resolutionNote: input.note?.trim() || null,
          },
        });
    await audit(
      ctx,
      {
        event: 'STAGE_CHANGED',
        objectType: 'collection_recovery',
        recordId: row.id,
        previousValue: { status: 'RESOLUTION_PROPOSED', proposedOutcome: row.proposedOutcome },
        newValue: input.approve
          ? { status: 'RESOLVED', outcome: row.proposedOutcome, note: input.note ?? null }
          : { status: 'ACKNOWLEDGED', declined: true, note: input.note ?? null },
      },
      tx,
    );
    return updated;
  });
}
