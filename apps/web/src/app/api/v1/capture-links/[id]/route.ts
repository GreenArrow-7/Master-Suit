import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { LEAD_MODULES } from '@/lib/security/entitlements';

/** Rename, re-point or switch off a capture link. A switched-off link's page is a 404. */
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
  async ({ ctx, params, body }) =>
    prisma.captureLink.update({
      where: { tenantId: ctx.tenantId, id: params.id },
      data: body,
      select: { id: true, isActive: true },
    }),
);
