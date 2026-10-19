import { z } from 'zod';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { route } from '@/lib/api/handler';
import { CALL_LOG_OUTCOMES } from '@/lib/leads/callLog';
import { logLeadCall } from '@/services/leads/logCall';
import { workspaceTimezone } from '@/services/hr/attendance';
import { dayBounds } from '@/services/targets/dailyBoard';

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
    /**
     * The provider call this log is the outcome of (M9-02): the outcome and note
     * go onto that call, which is already on the timeline, and no second call is logged.
     */
    callId: z.string().cuid().optional(),
    /**
     * The call logged automatically from the phone app that this log corrects (M9-09):
     * its outcome, note and minutes are rewritten and no second call is logged. The
     * caller's own call on this lead, else 404.
     */
    activityId: z.string().cuid().optional(),
    notes: z.string().trim().max(2000).optional(),
    durationMins: z.number().int().min(0).max(600).optional(),
    /** The talk time as the phone app measured it (M9-09); takes the place of `durationMins`. */
    durationSecs: z.number().int().min(0).max(36_000).optional(),
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
 * The one-step call log (PROP-02.2, M4-27) from the lead page and the lead
 * lists: `logLeadCall` (`services/leads/logCall.ts`), which the phone's call
 * log runs too, with the follow-up read on the workspace's clock and the
 * dialog's `requestKey` kept with the call. With an `activityId` (the call the
 * phone app logged by itself, M9-09) the log corrects that call in place.
 */
export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'EDIT', params, body },
  async ({ ctx, params, body }) => {
    const { requestKey, followUpAt, durationMins, outcome, notes, occurredAt, callId, activityId } = body;
    const leadId = params.id;
    const dueAt = followUpAt ? onWorkspaceClock(followUpAt, await workspaceTimezone(ctx)) : null;
    const key = requestKey
      ? {
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
            callId: callId ?? null,
            // Only when sent, so a key recorded before these existed still replays.
            ...(body.durationSecs !== undefined && { durationSecs: body.durationSecs }),
            ...(activityId && { activityId }),
          },
        }
      : undefined;
    return logLeadCall(
      ctx,
      leadId,
      {
        outcome,
        notes,
        durationSecs: body.durationSecs ?? (durationMins === undefined ? undefined : durationMins * 60),
        dueAt,
        occurredAt,
        callId,
        activityId,
      },
      key,
    );
  },
);
