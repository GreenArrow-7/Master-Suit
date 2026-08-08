import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Invalid } from '@/lib/errors';

const params = z.object({ id: z.string().cuid() });

const body = z
  .object({
    /** Callers to spread the queue across, round-robin. Defaults to the requester. */
    callerIds: z.array(z.string().cuid()).min(1).max(50).optional(),
    /** Only queue invitees currently in these RSVP states. */
    rsvpStatus: z.array(z.enum(['PENDING', 'NO_RESPONSE', 'TENTATIVE', 'CONFIRMED', 'DECLINED'])).optional(),
  })
  .strict();

/** ponytail: capped per request; re-run to queue the next slice. Batch it through the
 *  distribution worker in src/workers/distribution.ts if events grow past a few hundred. */
const BATCH_LIMIT = 200;

/**
 * The event-calling queue: one SCHEDULED Call per invitee, linked to the event and
 * the lead. Agents work it from /sales/calls; consent, recording, transcript and
 * Gemini analysis then run through the existing per-call endpoints unchanged.
 */
export const POST = route(
  { module: 'calls', productModule: 'SALES', action: 'CREATE', params, body, auditEvent: 'CALL_STARTED' },
  async ({ ctx, params, body }) => {
    const event = await prisma.event.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!event) throw NotFound('Event');

    const callerIds = body.callerIds ?? [ctx.actor.id];
    const callers = await prisma.user.findMany({
      where: { id: { in: callerIds }, tenantId: ctx.tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (callers.length !== callerIds.length) {
      throw Invalid([
        { field: 'callerIds', code: 'unknown_user', message: 'Every caller must be an active user of this workspace.' },
      ]);
    }

    const invitees = await prisma.eventInvitee.findMany({
      where: {
        tenantId: ctx.tenantId,
        eventId: event.id,
        phone: { not: null },
        ...(body.rsvpStatus ? { rsvpStatus: { in: body.rsvpStatus } } : {}),
      },
      select: { id: true, phone: true, leadId: true, contactId: true },
      take: BATCH_LIMIT,
    });

    // Never queue the same invitee twice for one event.
    const queued = await prisma.call.findMany({
      where: {
        tenantId: ctx.tenantId,
        eventId: event.id,
        deletedAt: null,
        status: { in: ['SCHEDULED', 'RINGING', 'IN_PROGRESS'] },
      },
      select: { recipientNumber: true },
    });
    const alreadyQueued = new Set(queued.map((c) => c.recipientNumber));

    const pending = invitees.filter((i) => !alreadyQueued.has(i.phone));
    if (pending.length === 0) return { queued: 0, skipped: invitees.length };

    const created = await prisma.call.createMany({
      data: pending.map((invitee, index) => ({
        tenantId: ctx.tenantId,
        eventId: event.id,
        leadId: invitee.leadId,
        contactId: invitee.contactId,
        campaignId: event.campaignId,
        callerId: callers[index % callers.length].id,
        direction: 'OUTBOUND' as const,
        status: 'SCHEDULED' as const,
        recipientNumber: invitee.phone,
        notes: `Event: ${event.title}`,
      })),
    });

    return { queued: created.count, skipped: invitees.length - pending.length };
  },
);
