import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { visibilityWhere } from '@/lib/security/visibility';

const body = z
  .object({
    leadIds: z.array(z.string().cuid()).min(1).max(500),
    ownerId: z.string().cuid(),
  })
  .strict();

export const POST = route(
  { module: 'leads', productModule: LEAD_MODULES, action: 'ASSIGN', body, auditEvent: 'OWNER_CHANGED' },
  async ({ ctx, body: { leadIds, ownerId } }) => {
    const owner = await prisma.user.findFirst({
      where: { id: ownerId, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!owner) throw NotFound('User');

    // Only the leads the caller may assign. One outside that reach is skipped
    // like a missing one, so the count confirms no id.
    const scope = await visibilityWhere(ctx, 'leads', 'ASSIGN', { includeUnassigned: true });
    const ids = (
      await prisma.lead.findMany({ where: { ...scope, id: { in: leadIds }, deletedAt: null }, select: { id: true } })
    ).map((lead) => lead.id);
    if (ids.length === 0) return { assigned: 0 };

    const now = new Date();

    const [updated] = await prisma.$transaction([
      prisma.lead.updateMany({
        where: { id: { in: ids }, tenantId: ctx.tenantId },
        data: { ownerId, assignedAt: now, updatedById: ctx.actor.id },
      }),
      // record assignment history for each lead
      prisma.leadAssignmentHistory.createMany({
        data: ids.map((leadId) => ({
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
