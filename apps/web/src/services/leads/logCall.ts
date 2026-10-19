import { prisma, withTx, type TxClient } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { assertCallInScope, assertLeadInScope } from '@/lib/security/record-scope';
import { can, type Ctx } from '@/lib/security/rbac';
import { NotFound } from '@/lib/errors';
import { CALL_OUTCOME_OF, FOLLOW_UP_TITLE, type CALL_LOG_OUTCOMES } from '@/lib/leads/callLog';
import { reachedOut, touchLead } from '@/services/leads/touch';
import { scoreActivity } from '@/services/leads/scoring';
import { withRecompute } from '@/services/leads/nextFollowUp';
import { queueCalendarSync } from '@/services/integrations/calendarSync';
import { findReplay, recordOutcome, type IdempotencyRequest } from '@/services/idempotency';

export interface CallLogInput {
  outcome: (typeof CALL_LOG_OUTCOMES)[number];
  notes?: string;
  durationSecs?: number;
  /** The next follow-up's instant; none when null. */
  dueAt: Date | null;
  /** The follow-up's own note; the call's note when left out. */
  followUpNote?: string;
  /** When the call happened, checked by the caller; now when left out. */
  occurredAt?: Date;
  /** The provider call this log is the outcome of (M9-02). */
  callId?: string;
  /** The call the phone app logged by itself that this log corrects in place (M9-09). */
  activityId?: string;
}

/**
 * The one-step call log (PROP-02.2, M4-27), for the lead page and lists
 * (`POST /api/v1/leads/{id}/call-log`) and the phone (`POST
 * /api/mobile/leads/{id}/call`): what the call found, a note and the next
 * follow-up, in one transaction. The call is an outbound-call Activity on the
 * lead, scored as one logged from the timeline (M4-11); the follow-up is the
 * caller's, on the lead, and moves its next follow-up date. Both are audited in
 * the transaction. Outside the caller's `leads:EDIT` scope the lead answers 404
 * and nothing is written. With a `callId` the outcome is that call's own, and a
 * call outside the caller's `calls:EDIT` reach or on another lead answers 404.
 * With an `activityId` (the call the phone app logged by itself, M9-09) the log
 * corrects that call in place: the caller's own outbound call on this lead,
 * else 404. `key`, the caller's own request key, is checked after the scope and
 * recorded in the transaction.
 */
export async function logLeadCall(ctx: Ctx, leadId: string, input: CallLogInput, key?: IdempotencyRequest) {
  const { outcome, notes, durationSecs, dueAt, occurredAt, callId, activityId } = input;
  /** The call `activityId` may correct: the caller's own outbound call on this lead. */
  const ownCall = activityId && {
    tenantId: ctx.tenantId,
    id: activityId,
    leadId,
    ownerId: ctx.actor.id,
    deletedAt: null,
    type: { key: 'call_out' },
  };

  // 404 outside the caller's scope before anything else, a replay included.
  await assertLeadInScope(ctx, leadId, prisma, 'EDIT');
  // A write to a call takes calls:EDIT, as PATCH /calls/:id does: callScope's
  // own-calls fallback is for reading a call under `leads`, not changing it.
  if (callId && !can(ctx, 'calls', 'EDIT')) throw NotFound('Call');
  const placed = callId ? await assertCallInScope(ctx, callId, 'EDIT') : null;
  if (placed && placed.leadId !== leadId) throw NotFound('Call');
  if (ownCall && !placed && !(await prisma.activity.findFirst({ where: ownCall, select: { id: true } }))) {
    throw NotFound('Activity');
  }
  const replay = key ? await findReplay<{ activity: { id: string; occurredAt: string } }>(key) : null;
  if (replay) return replay.result;

  /** The next follow-up, the caller's, on the lead (and the call it follows), audited with what it follows. */
  async function bookFollowUp(tx: TxClient, follows: Record<string, string>) {
    const followUp = await withRecompute(tx, ctx.tenantId, [leadId], () =>
      tx.followUpTask.create({
        data: {
          tenantId: ctx.tenantId,
          leadId,
          callId: placed?.id ?? null,
          ownerId: ctx.actor.id,
          createdById: ctx.actor.id,
          title: FOLLOW_UP_TITLE,
          description: input.followUpNote || notes || null,
          dueAt: dueAt!,
        },
        select: { id: true, dueAt: true },
      }),
    );
    await audit(
      ctx,
      { event: 'RECORD_CREATED', objectType: 'follow-up', recordId: followUp.id, metadata: { leadId, ...follows } },
      tx,
    );
    return followUp;
  }

  if (placed) {
    const result = await withTx(ctx.tenantId, async (tx) => {
      await tx.call.updateMany({
        where: { tenantId: ctx.tenantId, id: placed.id },
        // After what the live screen saved during the call, never over it.
        data: {
          outcome: CALL_OUTCOME_OF[outcome],
          ...(notes && { notes: [placed.notes, notes].filter(Boolean).join('\n') }),
        },
      });
      await audit(
        ctx,
        { event: 'RECORD_UPDATED', objectType: 'call', recordId: placed.id, metadata: { leadId, outcome } },
        tx,
      );
      const followUp = dueAt ? await bookFollowUp(tx, { callId: placed.id }) : null;
      const done = { call: { id: placed.id, outcome: CALL_OUTCOME_OF[outcome] }, followUp };
      if (key) await recordOutcome(tx, key, done);
      return done;
    });
    await touchLead(ctx.tenantId, leadId, undefined, reachedOut(placed));
    // On the workspace's calendars where they hold every follow-up (M8-08, M8-09).
    await queueCalendarSync(ctx.tenantId, 'followUp', result.followUp?.id);
    return result;
  }

  if (ownCall) {
    const corrected = await withTx(ctx.tenantId, async (tx) => {
      const { count } = await tx.activity.updateMany({
        where: ownCall,
        data: {
          outcome,
          ...(notes && { notes }),
          ...(durationSecs !== undefined && { durationSecs }),
          updatedById: ctx.actor.id,
        },
      });
      // Deleted since the check above.
      if (!count) throw NotFound('Activity');
      await audit(
        ctx,
        { event: 'RECORD_UPDATED', objectType: 'activity', recordId: ownCall.id, metadata: { leadId, outcome } },
        tx,
      );
      const followUp = dueAt ? await bookFollowUp(tx, { activityId: ownCall.id }) : null;
      const result = { activity: { id: ownCall.id, outcome }, followUp };
      if (key) await recordOutcome(tx, key, result);
      return result;
    });
    await queueCalendarSync(ctx.tenantId, 'followUp', corrected.followUp?.id);
    return corrected;
  }

  const logged = await withTx(ctx.tenantId, async (tx) => {
    // The outbound-call type, as the cold-call log and the move tool find it.
    const type = await tx.activityType.upsert({
      where: { tenantId_key: { tenantId: ctx.tenantId, key: 'call_out' } },
      update: {},
      create: { tenantId: ctx.tenantId, key: 'call_out', name: 'Outbound call', scoreDelta: 3 },
      select: { id: true },
    });
    const activity = await tx.activity.create({
      data: {
        tenantId: ctx.tenantId,
        typeId: type.id,
        leadId,
        ownerId: ctx.actor.id,
        outcome,
        notes: notes || undefined,
        durationSecs,
        occurredAt,
      },
      select: { id: true, leadId: true, typeId: true, outcome: true, occurredAt: true },
    });
    await scoreActivity(tx, ctx, activity);
    await audit(
      ctx,
      { event: 'RECORD_CREATED', objectType: 'activity', recordId: activity.id, metadata: { leadId, outcome } },
      tx,
    );
    const followUp = dueAt ? await bookFollowUp(tx, { activityId: activity.id }) : null;
    const result = { activity, followUp };
    if (key) await recordOutcome(tx, key, result);
    return result;
  });
  await touchLead(ctx.tenantId, leadId, new Date(logged.activity.occurredAt));
  await queueCalendarSync(ctx.tenantId, 'followUp', logged.followUp?.id);
  return logged;
}
