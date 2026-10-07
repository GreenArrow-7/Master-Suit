import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';

/** Hand a list's unconverted records to one agent, or back to nobody. */
export const POST = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'ASSIGN',
    body: z.object({ batch: z.string().min(1).max(160), ownerId: z.string().cuid().nullable() }).strict(),
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, body }) => {
    if (body.ownerId) {
      const agent = await prisma.user.findFirst({
        where: { tenantId: ctx.tenantId, id: body.ownerId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!agent) throw NotFound('User');
    }
    const { count } = await prisma.dataRecord.updateMany({
      where: { tenantId: ctx.tenantId, batch: body.batch, convertedLeadId: null },
      data: { ownerId: body.ownerId },
    });
    return { assigned: count };
  },
);
