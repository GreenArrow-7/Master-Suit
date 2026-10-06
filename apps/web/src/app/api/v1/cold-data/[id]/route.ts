import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Forbidden } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { can } from '@/lib/security/rbac';
import { coldDataScope } from '@/services/leads/coldData';

/** Working a record: what the call found, a note, and (with ASSIGN) whose it is. */
export const PATCH = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params: z.object({ id: z.string().cuid() }),
    body: z
      .object({
        status: z.enum(['NOT_CONTACTED', 'NOT_REACHABLE', 'NOT_INTERESTED', 'INTERESTED', 'INVALID']).optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
        ownerId: z.string().cuid().nullable().optional(),
      })
      .strict(),
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    if (body.ownerId !== undefined && !can(ctx, 'leads', 'ASSIGN')) throw Forbidden('Your role cannot assign records.');
    // Converted records are history: their lead is where the work happens now.
    return prisma.dataRecord.update({
      where: { ...coldDataScope(ctx), id: params.id, convertedLeadId: null },
      data: body,
      select: { id: true, status: true },
    });
  },
);
