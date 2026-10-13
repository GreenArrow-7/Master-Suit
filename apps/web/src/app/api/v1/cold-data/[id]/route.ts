import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Forbidden } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { can } from '@/lib/security/rbac';
import { assertAssignableUser } from '@/lib/security/record-scope';
import { CALL_OUTCOMES, coldDataScope, logColdCall } from '@/services/leads/coldData';

/**
 * Working a record: what the call found (a logged call, M5-06), a note, and
 * (with ASSIGN) whose it is. The record is reached under the lead rule at
 * EDIT; outside it answers as a missing id.
 */
export const PATCH = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params: z.object({ id: z.string().cuid() }),
    body: z
      .object({
        status: z.enum(['NOT_CONTACTED', ...CALL_OUTCOMES]).optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
        ownerId: z.string().cuid().nullable().optional(),
      })
      .strict(),
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    if (body.ownerId !== undefined && !can(ctx, 'leads', 'ASSIGN')) throw Forbidden('Your role cannot assign records.');
    if (body.ownerId) await assertAssignableUser(ctx, prisma, 'leads', 'ASSIGN', body.ownerId);
    const { status } = body;
    if (status && status !== 'NOT_CONTACTED') return logColdCall(ctx, params.id, { ...body, status });
    // Converted records are history: their lead is where the work happens now.
    return prisma.dataRecord.update({
      where: { ...(await coldDataScope(ctx, 'EDIT')), id: params.id, convertedLeadId: null },
      data: body,
      select: { id: true, status: true },
    });
  },
);
