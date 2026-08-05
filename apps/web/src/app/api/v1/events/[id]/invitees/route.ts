import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const params = z.object({ id: z.string().cuid() });

const addBody = z.object({
  invitees: z.array(z.object({
    leadId: z.string().cuid().optional(),
    contactId: z.string().cuid().optional(),
    email: z.string().email().optional(),
    phone: z.string().max(32).optional(),
    name: z.string().max(160).optional(),
    inviteChannel: z.enum(['EMAIL', 'WHATSAPP', 'SMS', 'IN_APP']).default('EMAIL'),
  })).min(1).max(500),
}).strict();

export const POST = route(
  { module: 'events', action: 'EDIT', params, body: addBody },
  async ({ ctx, params, body }) => {
    const created = await prisma.eventInvitee.createMany({
      data: body.invitees.map((inv) => ({
        tenantId: ctx.tenantId,
        eventId: params.id,
        ...inv,
      })),
      skipDuplicates: true,
    });

    await prisma.event.update({
      where: { id: params.id, tenantId: ctx.tenantId },
      data: { registeredCount: { increment: created.count } },
    });

    return { added: created.count };
  },
);
