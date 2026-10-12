import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { targetReach } from '@/lib/security/record-scope';
import type { Ctx } from '@/lib/security/rbac';

const patchBody = z
  .object({
    targetValue: z.number().int().positive().optional(),
    periodEnd: z.coerce.date().optional(),
  })
  .strict();

/** A target by id, under `targetReach`; outside it, not found (P2025). */
const reach = async (ctx: Ctx, id: string) => ({ ...(await targetReach(ctx)), id });

export const PATCH = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'ASSIGN',
    body: patchBody,
    params: z.object({ id: z.string() }),
    auditEvent: 'TARGET_UPDATED',
  },
  async ({ ctx, params, body }) => {
    return prisma.employeeTarget.update({ where: await reach(ctx, params.id), data: body });
  },
);

export const DELETE = route(
  {
    module: 'leads',
    productModule: LEAD_MODULES,
    action: 'ASSIGN',
    params: z.object({ id: z.string() }),
    auditEvent: 'RECORD_DELETED',
  },
  async ({ ctx, params }) => {
    await prisma.employeeTarget.delete({ where: await reach(ctx, params.id) });
    // The id names the deleted target in the audit row.
    return { ok: true, id: params.id };
  },
);
