import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { assertAssignableUser } from '@/lib/security/record-scope';
import { coldDataScope } from '@/services/leads/coldData';

/**
 * Hand a list's unconverted records to one agent, or back to nobody: the ones
 * the caller works (coldDataScope). Without it, an assigner below
 * organisation-wide lead access moved every agent's records in the list.
 */
export const POST = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'ASSIGN',
    body: z.object({ batch: z.string().min(1).max(160), ownerId: z.string().cuid().nullable() }).strict(),
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, body }) => {
    if (body.ownerId) await assertAssignableUser(ctx, prisma, 'leads', 'ASSIGN', body.ownerId);
    const { count } = await prisma.dataRecord.updateMany({
      where: { ...coldDataScope(ctx), batch: body.batch, convertedLeadId: null },
      data: { ownerId: body.ownerId },
    });
    return { assigned: count };
  },
);
