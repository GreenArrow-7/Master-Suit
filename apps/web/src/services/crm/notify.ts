/**
 * Telling a salesperson that something moved on one of their records.
 *
 * The CRM side had exactly one producer of notifications: the automation engine's
 * `notify_owner` / `notify_manager` actions, which only fire when somebody has
 * built a rule. So a workspace that never opened the automation builder — most of
 * them — got a bell that was permanently empty while leads were being created,
 * reassigned, moved between stages and called all day.
 *
 * This is the same shape as `services/hr/notify.ts`: a registry keyed by event,
 * answering who cares, what it says, and where it goes. Two things differ, both
 * because sales records are owned and HR queues are not:
 *
 *   Audience is the record's owner, not "whoever holds a permission". A lead
 *   belongs to one person; telling the whole sales floor that a lead changed
 *   stage is how a bell gets muted in a week. `alsoNotify` exists for the cases
 *   where a second person genuinely needs it — the previous owner on a
 *   reassignment, who otherwise watches a record vanish with no explanation.
 *
 *   In-app only. HR's events are approvals with a service-level expectation
 *   behind them; "a lead moved to Contacted" is not worth an email, and a system
 *   that sends one per stage change trains people to filter it. If an event here
 *   ever does warrant one, add the channel to that event rather than to all of
 *   them — the notifications worker already handles delivery.
 */
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { Ctx } from '@/lib/security/rbac';

/**
 * Every event this system can raise. Kept to the ones something actually emits:
 * a key nobody writes is a promise the panel never keeps.
 *
 * Two names from the brief are covered by keys that read differently:
 *   * "lead status change" is `lead.stage_changed` — stage *is* the status on
 *     this model, and `Lead.status` is a separate, largely unused free-text
 *     column that no screen writes.
 *   * "lead reminder" is `follow_up.due`, raised by the sweep in `reminders.ts`
 *     and pointed at the lead the task hangs off.
 */
export type CrmEventKey =
  | 'lead.created'
  | 'lead.assigned'
  | 'lead.stage_changed'
  | 'follow_up.due'
  | 'call.scheduled'
  | 'call.reminder'
  | 'call.missed'
  | 'call.completed';

export interface CrmNotification {
  event: CrmEventKey;
  /** The record's owner. Undefined for an unassigned lead — nobody to tell yet. */
  ownerId?: string | null;
  /** Anyone else who needs this: the previous owner, a manager, a watcher. */
  alsoNotify?: (string | null | undefined)[];
  title: string;
  body?: string;
  /**
   * The record this points at, as a type `lib/nav/entityRoute.ts` can resolve,
   * plus its id. Never a path: the reader's workspace slug is not known here,
   * and a stored path is what made every one of these clicks 404 before.
   */
  objectType: 'lead' | 'call' | 'contact' | 'opportunity';
  recordId: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}

/**
 * Write the in-app rows.
 *
 * Never throws. A lead must not fail to save because the bell could not be
 * updated — the record is the durable thing. Failures are logged with the event
 * so a silent bell is diagnosable rather than invisible.
 */
export async function notifyCrm(ctx: Ctx, notification: CrmNotification): Promise<{ recipients: number }> {
  try {
    /**
     * The actor is excluded. Being told about the thing you just did is noise,
     * and it is most of the volume here: the person creating a lead is usually
     * the person it is assigned to, so without this filter the commonest event
     * in the system is a notification to yourself about your own click.
     */
    const recipients = [...new Set([notification.ownerId, ...(notification.alsoNotify ?? [])])].filter(
      (id): id is string => Boolean(id) && id !== ctx.actor.id,
    );
    if (!recipients.length) return { recipients: 0 };

    // Deactivated logins keep their rows and would silently accumulate an
    // unread count nobody will ever open.
    const active = await prisma.user.findMany({
      where: { tenantId: ctx.tenantId, id: { in: recipients }, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!active.length) return { recipients: 0 };

    await prisma.notification.createMany({
      data: active.map((user) => ({
        tenantId: ctx.tenantId,
        userId: user.id,
        kind: notification.event,
        title: notification.title,
        body: notification.body ?? null,
        objectType: notification.objectType,
        recordId: notification.recordId,
        priority: notification.priority ?? 'MEDIUM',
        channels: ['in_app'],
      })),
    });

    return { recipients: active.length };
  } catch (err) {
    logger.error({ err, event: notification.event }, 'crm notification failed');
    return { recipients: 0 };
  }
}

/**
 * Call events, addressed to the lead's owner rather than the caller.
 *
 * `Call.callerId` is set to the actor on every create, so notifying "the caller"
 * would mean notifying the person who just clicked — which `notifyCrm` drops.
 * The person who needs to hear that a call was missed is whoever owns the lead
 * it was about, and they are frequently not the one who dialled.
 *
 * The destination is the lead where there is one. A missed call's useful screen
 * is the record you now have to chase, not the log entry saying you missed it;
 * calls with no lead attached fall back to the call itself.
 */
export async function notifyAboutCall(
  ctx: Ctx,
  call: { id: string; leadId: string | null; callerId: string | null },
  event: Extract<CrmEventKey, 'call.scheduled' | 'call.missed' | 'call.completed'>,
  title: string,
  body?: string,
): Promise<{ recipients: number }> {
  const lead = call.leadId
    ? await prisma.lead.findFirst({
        where: { tenantId: ctx.tenantId, id: call.leadId },
        select: { id: true, ownerId: true },
      })
    : null;

  return notifyCrm(ctx, {
    event,
    ownerId: lead?.ownerId,
    // The dialler hears about their own missed call only when somebody else owns
    // the lead and the two are different people.
    alsoNotify: [call.callerId],
    title,
    body,
    objectType: lead ? 'lead' : 'call',
    recordId: lead ? lead.id : call.id,
    priority: event === 'call.missed' ? 'HIGH' : 'MEDIUM',
  });
}
