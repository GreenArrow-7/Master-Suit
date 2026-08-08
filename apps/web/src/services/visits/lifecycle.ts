/**
 * The site-visit register.
 *
 * The acceptance criterion is two sentences and they are both here: the state
 * machine rejects illegal transitions, and a completed visit cannot be edited
 * without an audit entry.
 *
 * The second is the harder one to keep honest. It is easy to write a route that
 * audits when it remembers to; what is written instead is an amendment path
 * that *cannot* succeed without a reason — enforced by a CHECK constraint as
 * well as here, because a correction made by a direct UPDATE is exactly the one
 * nobody would otherwise see.
 */
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { can } from '@/lib/security/rbac';

export const VISIT_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/**
 * Legal moves.
 *
 * CHECKED_IN is reachable only from APPROVED, and only by punching — an agent
 * cannot mark themselves as having arrived somewhere they were never approved
 * to go, which is the point of the register.
 *
 * COMPLETED is terminal for the *status*. Correcting what happened is an
 * amendment, not a transition, and it takes a different path.
 */
const ALLOWED: Record<VisitStatus, readonly VisitStatus[]> = {
  REQUESTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  REJECTED: [],
  CHECKED_IN: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export const canTransition = (from: VisitStatus, to: VisitStatus) => ALLOWED[from].includes(to);

/** Transitions only a leader may make. Approving your own visit is not a visit register. */
const LEADER_ONLY: readonly VisitStatus[] = ['APPROVED', 'REJECTED'];

export interface TransitionInput {
  ctx: Ctx;
  visitId: string;
  to: VisitStatus;
  note?: string;
}

export async function transition(input: TransitionInput) {
  const { ctx } = input;

  return withTx(ctx.tenantId, async (tx) => {
    const visit = await tx.siteVisit.findFirst({
      where: { id: input.visitId, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!visit) throw NotFound('Site visit');

    const from = visit.status as VisitStatus;
    if (from === input.to) throw Conflict(`This visit is already ${input.to.toLowerCase().replace('_', ' ')}.`);
    if (!canTransition(from, input.to)) {
      throw Invalid([
        {
          field: 'status',
          code: 'illegal_transition',
          message: `A ${from.toLowerCase().replace('_', ' ')} visit cannot become ${input.to
            .toLowerCase()
            .replace('_', ' ')}.`,
        },
      ]);
    }

    if (LEADER_ONLY.includes(input.to)) {
      if (!can(ctx, 'visits', 'APPROVE')) throw Forbidden('Approving a visit is a leader decision.');
      // Signing off your own trip is not a decision, it is a formality with a
      // name on it. Refused even for a leader.
      if (visit.ownerId === ctx.actor.id) {
        throw Forbidden('You cannot decide your own visit. Ask someone else to approve it.');
      }
    }

    // CHECKED_IN is reached by punching, never by asking. `punch()` calls the
    // same machine with the coordinates it measured.
    if (input.to === 'CHECKED_IN') {
      throw Invalid([
        { field: 'status', code: 'punch_required', message: 'Check in by punching at the property, not by editing.' },
      ]);
    }

    const updated = await tx.siteVisit.update({
      where: { id: visit.id, tenantId: ctx.tenantId },
      data: {
        status: input.to,
        decidedById: LEADER_ONLY.includes(input.to) ? ctx.actor.id : undefined,
        decidedAt: LEADER_ONLY.includes(input.to) ? new Date() : undefined,
        decisionNote: LEADER_ONLY.includes(input.to) ? input.note : undefined,
        checkOutAt: input.to === 'COMPLETED' ? (visit.checkOutAt ?? new Date()) : undefined,
        updatedById: ctx.actor.id,
      },
    });

    // Inside the transaction, deliberately. An audit written afterwards can
    // fail on its own, and a transition with no record of who made it is the
    // thing this register exists to prevent.
    await audit(
      ctx,
      {
        event: 'STAGE_CHANGED',
        objectType: 'visits',
        recordId: visit.id,
        previousValue: { status: from },
        newValue: { status: input.to, note: input.note },
      },
      tx,
    );

    return { visit: updated, from };
  });
}

export interface AmendInput {
  ctx: Ctx;
  visitId: string;
  reason: string;
  outcome?: string;
  notes?: string;
}

/**
 * Correcting a completed visit.
 *
 * The acceptance criterion, in code. A completed visit is evidence — of a trip
 * claimed, a client met, and often a commission that follows — so it is not
 * edited, it is amended: the reason is mandatory, the before and after are both
 * written to the audit log, and the row carries who did it and when.
 *
 * Only fields describing what happened may be amended. The schedule, the
 * client, the destination and the punch are not correctable here; a visit
 * recorded against the wrong property is a different visit.
 */
export async function amendCompleted(input: AmendInput) {
  const { ctx } = input;
  const reason = input.reason.trim();

  if (reason.length < 5) {
    throw Invalid([{ field: 'reason', code: 'required', message: 'Say why this completed visit is being corrected.' }]);
  }

  return withTx(ctx.tenantId, async (tx) => {
    const visit = await tx.siteVisit.findFirst({
      where: { id: input.visitId, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!visit) throw NotFound('Site visit');
    if (visit.status !== 'COMPLETED') {
      throw Conflict('Only a completed visit is amended. Edit it normally while it is still open.');
    }

    const before = { outcome: visit.outcome, notes: visit.notes };
    const after = {
      outcome: input.outcome ?? visit.outcome,
      notes: input.notes ?? visit.notes,
    };

    const updated = await tx.siteVisit.update({
      where: { id: visit.id, tenantId: ctx.tenantId },
      data: {
        ...after,
        amendedAt: new Date(),
        amendedById: ctx.actor.id,
        amendReason: reason,
        // An amendment puts the visit back in front of a leader: the record
        // changed after it was signed off, so the sign-off no longer covers it.
        verification: 'PENDING',
        verifiedById: null,
        verifiedAt: null,
        updatedById: ctx.actor.id,
      },
    });

    // Same transaction as the amendment itself: the acceptance criterion is
    // that a completed visit cannot be edited *without* an audit entry, and two
    // separate writes is exactly how one lands without the other.
    await audit(
      ctx,
      {
        event: 'RECORD_UPDATED',
        objectType: 'visits',
        recordId: visit.id,
        previousValue: before,
        newValue: { ...after, amendReason: reason },
      },
      tx,
    );

    return updated;
  });
}

export interface VerifyInput {
  ctx: Ctx;
  visitId: string;
  verdict: 'VERIFIED' | 'DISPUTED';
  note?: string;
}

/**
 * A leader deciding whether to believe a visit.
 *
 * Separate from approval, and after the fact. Approval says "you may go";
 * verification says "I accept that you went" — and it is the one that matters
 * when a visit is the evidence behind a commission.
 */
export async function verify(input: VerifyInput) {
  const { ctx } = input;
  if (!can(ctx, 'visits', 'MANAGE_USERS')) throw Forbidden('Verifying a visit is a leader decision.');

  return withTx(ctx.tenantId, async (tx) => {
    const visit = await tx.siteVisit.findFirst({
      where: { id: input.visitId, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, status: true, verification: true, ownerId: true },
    });
    if (!visit) throw NotFound('Site visit');
    if (visit.status !== 'COMPLETED' && visit.status !== 'NO_SHOW') {
      throw Conflict('There is nothing to verify until the visit has finished.');
    }
    if (visit.ownerId === ctx.actor.id) throw Forbidden('You cannot verify your own visit.');

    const updated = await tx.siteVisit.update({
      where: { id: visit.id, tenantId: ctx.tenantId },
      data: {
        verification: input.verdict,
        verifiedById: ctx.actor.id,
        verifiedAt: new Date(),
        // A dispute is a note somebody will read later; it belongs on the row,
        // not only in the log.
        decisionNote: input.note ?? undefined,
        updatedById: ctx.actor.id,
      },
    });

    await audit(
      ctx,
      {
        event: 'RECORD_UPDATED',
        objectType: 'visits',
        recordId: visit.id,
        previousValue: { verification: visit.verification },
        newValue: { verification: input.verdict, note: input.note },
      },
      tx,
    );

    return updated;
  });
}

/** The two lists a leader actually opens. */
export async function leaderQueues(tenantId: string) {
  const [awaitingApproval, awaitingVerification] = await Promise.all([
    prisma.siteVisit.count({ where: { tenantId, deletedAt: null, status: 'REQUESTED' } }),
    prisma.siteVisit.count({
      where: { tenantId, deletedAt: null, status: { in: ['COMPLETED', 'NO_SHOW'] }, verification: 'PENDING' },
    }),
  ]);
  return { awaitingApproval, awaitingVerification };
}
