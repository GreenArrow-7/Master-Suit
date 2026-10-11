import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Forbidden } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { can } from '@/lib/security/rbac';
import { assertAssignableUser } from '@/lib/security/record-scope';

/**
 * Rename, re-point or switch off a capture link. A switched-off link's page is a
 * 404. Without leads:ASSIGN, only your own links, and not who they go to.
 */
export const PATCH = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params: z.object({ id: z.string().cuid() }),
    body: z
      .object({
        label: z.string().trim().min(2).max(80).optional(),
        headline: z.string().trim().max(120).nullable().optional(),
        ownerId: z.string().cuid().nullable().optional(),
        campaign: z.string().trim().max(80).nullable().optional(),
        isActive: z.boolean().optional(),
      })
      .strict(),
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    const assigner = can(ctx, 'leads', 'ASSIGN');
    if (body.ownerId !== undefined && !assigner) throw Forbidden('Your role cannot assign leads.');
    if (body.ownerId) await assertAssignableUser(ctx, prisma, 'leads', 'ASSIGN', body.ownerId);
    return prisma.captureLink.update({
      where: { tenantId: ctx.tenantId, id: params.id, ...(!assigner && { ownerId: ctx.actor.id }) },
      data: body,
      select: { id: true, isActive: true },
    });
  },
);
