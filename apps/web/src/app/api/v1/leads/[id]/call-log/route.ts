import { z } from 'zod';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { assertLeadInScope } from '@/lib/security/record-scope';
import { CALL_LOG_OUTCOMES, FOLLOW_UP_TITLE } from '@/lib/leads/callLog';
import { touchLead } from '@/services/leads/touch';
import { scoreActivity } from '@/services/leads/scoring';
import { withRecompute } from '@/services/leads/nextFollowUp';
import { workspaceTimezone } from '@/services/hr/attendance';
import { dayBounds } from '@/services/targets/dailyBoard';
import { findReplay, recordOutcome } from '@/services/idempotency';

const params = z.object({ id: z.string().cuid() });

/** "YYYY-MM-DDTHH:mm" on the workspace's clock, a day that exists. */
const wallClock = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'A date and time, as YYYY-MM-DDTHH:mm.')
  .refine(
    (at) => {
      const day = new Date(`${at.slice(0, 10)}T00:00:00Z`);
      // 30 February parses, as 2 March: the round trip is what refuses it.
      return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(at.slice(0, 10));
    },
    { message: 'That day does not exist.' },
  );

const body = z
  .object({
    outcome: z.enum(CALL_LOG_OUTCOMES),
    notes: z.string().trim().max(2000).optional(),
    durationMins: z.number().int().min(0).max(600).optional(),
    /** The next follow-up, on the workspace's clock; none when left out. */
    followUpAt: wallClock.optional(),
    /** A client's key for this one call, so a send repeated after a lost answer is not logged twice. */
    requestKey: z.string().uuid().optional(),
    /** When it happened, for one logged offline and sent later: within the last week, not ahead. */
    occurredAt: z.coerce
      .date()
      .refine((at) => at.getTime() <= Date.now() + 5 * 60_000 && at.getTime() >= Date.now() - 7 * 86_400_000, {
        message: 'A call is logged within a week of when it happened.',
      })
      .optional(),
  })
  .strict();

/** A wall-clock time in `timeZone` as an instant: the day's start there, plus the time. */
// ponytail: off by the shift on a day the clocks change (none in the Gulf); a zoned-time library if that matters.
function onWorkspaceClock(at: string, timeZone: string) {
  const minutes = Number(at.slice(11, 13)) * 60 + Number(at.slice(14, 16));
  return new Date(dayBounds(at.slice(0, 10), timeZone).from.getTime() + minutes * 60_000);
}

/**
 * The one-step call log (PROP-02.2, M4-27): what the call found, a note and
 * the next follow-up, in one request and one transaction. The call is an
 * outbound-call Activity on the lead, scored as one logged from the timeline
 * (M4-11); the follow-up is the caller's, on the lead, and moves its next
 * follow-up date. Both are audited in the transaction. Outside the caller's
 * `leads:EDIT` scope the lead answers 404 and nothing is written.
 */
export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'EDIT', params, body },
  async ({ ctx, params, body }) => {
    const { requestKey, followUpAt, durationMins, outcome, notes, occurredAt } = body;
    const leadId = params.id;
    const dueAt = followUpAt ? onWorkspaceClock(followUpAt, await workspaceTimezone(ctx)) : null;
    const key = requestKey && {
      tenantId: ctx.tenantId,
      operation: 'lead.call-log',
      requestKey,
      actorUserId: ctx.actor.id,
      input: {
        leadId,
        outcome,
        notes: notes ?? null,
        durationMins: durationMins ?? null,
        followUpAt: followUpAt ?? null,
      },
    };

    // 404 outside the caller's scope before anything else, a replay included.
    await assertLeadInScope(ctx, leadId, prisma, 'EDIT');
    const replay = key ? await findReplay<{ activity: { id: string; occurredAt: string } }>(key) : null;
    if (replay) return replay.result;

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
          durationSecs: durationMins === undefined ? undefined : durationMins * 60,
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
      const followUp = dueAt
        ? await withRecompute(tx, ctx.tenantId, [leadId], () =>
            tx.followUpTask.create({
              data: {
                tenantId: ctx.tenantId,
                leadId,
                ownerId: ctx.actor.id,
                createdById: ctx.actor.id,
                title: FOLLOW_UP_TITLE,
                description: notes || null,
                dueAt,
              },
              select: { id: true, dueAt: true },
            }),
          )
        : null;
      if (followUp) {
        await audit(
          ctx,
          {
            event: 'RECORD_CREATED',
            objectType: 'follow-up',
            recordId: followUp.id,
            metadata: { leadId, activityId: activity.id },
          },
          tx,
        );
      }
      const result = { activity, followUp };
      if (key) await recordOutcome(tx, key, result);
      return result;
    });
    await touchLead(ctx.tenantId, leadId, new Date(logged.activity.occurredAt));
    return logged;
  },
);
