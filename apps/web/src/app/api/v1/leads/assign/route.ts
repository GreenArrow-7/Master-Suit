import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const body = z.object({
  leadIds: z.array(z.string().cuid()).min(1).max(500),
  ownerId: z.string().cuid(),
}).strict();

export const POST = route(
  { module: 'leads', action: 'ASSIGN', body, auditEvent: 'OWNER_CHANGED' },
  async ({ ctx, body: { leadIds, ownerId } }) => {
    const owner = await prisma.user.findFirst({
      where: { id: ownerId, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!owner) throw new Error('Target user not found');

    const now = new Date();

    const [updated] = await prisma.$transaction([
      prisma.lead.updateMany({
        where: { id: { in: leadIds }, tenantId: ctx.tenantId },
        data: { ownerId, assignedAt: now, updatedById: ctx.actor.id },
      }),
      // record assignment history for each lead
      prisma.leadAssignmentHistory.createMany({
        data: leadIds.map((leadId) => ({
          tenantId: ctx.tenantId,
          leadId,
          toOwnerId: ownerId,
          assignedById: ctx.actor.id,
          reason: 'bulk_assignment',
        })),
      }),
    ]);

    return { assigned: updated.count };
  },
);
