import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const createBody = z.object({
  typeId: z.string().cuid(),
  leadId: z.string().cuid(),
  outcome: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  durationSecs: z.number().int().min(0).optional(),
}).strict();

export const POST = route(
  { module: 'leads', action: 'EDIT', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    return prisma.activity.create({
      data: {
        tenantId: ctx.tenantId,
        ownerId: ctx.actor.id,
        ...body,
      },
      include: { type: { select: { name: true, key: true } } },
    });
  },
);
