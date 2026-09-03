import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { requireMutableEvent } from '@/services/crm/eventVisibility';

const params = z.object({ id: z.string().cuid() });

const body = z
  .object({
    inviteeId: z.string().cuid(),
    rsvpStatus: z.enum(['CONFIRMED', 'DECLINED', 'TENTATIVE']),
    channel: z.enum(['EMAIL', 'WHATSAPP', 'SMS', 'IN_APP']).optional(),
  })
  .strict();

export const POST = route(
  { module: 'events', productModule: 'SALES', action: 'EDIT', params, body },
  async ({ ctx, params, body: { inviteeId, rsvpStatus, channel } }) => {
    await requireMutableEvent(ctx, params.id, 'EDIT');
    const invitee = await prisma.eventInvitee.findFirst({
      where: { id: inviteeId, eventId: params.id, tenantId: ctx.tenantId },
    });
    if (!invitee) throw NotFound('Invitee');

    const updated = await prisma.eventInvitee.update({
      where: { id: inviteeId, tenantId: ctx.tenantId },
      data: { rsvpStatus, rsvpAt: new Date(), rsvpChannel: channel },
    });

    return updated;
  },
);
