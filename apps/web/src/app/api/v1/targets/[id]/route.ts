import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import type { Ctx } from '@/lib/security/rbac';
import { visibilityWhere } from '@/lib/security/visibility';

const patchBody = z
  .object({
    targetValue: z.number().int().positive().optional(),
    periodEnd: z.coerce.date().optional(),
  })
  .strict();

/** A target by id, for someone the caller's `leads:ASSIGN` scope reaches; outside it, not found (P2025). */
const reach = async (ctx: Ctx, id: string) => ({
  ...(await visibilityWhere(ctx, 'leads', 'ASSIGN', { ownerField: 'userId' })),
  id,
});

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
  { module: 'leads', productModule: LEAD_MODULES, action: 'ASSIGN', params: z.object({ id: z.string() }) },
  async ({ ctx, params }) => {
    await prisma.employeeTarget.delete({ where: await reach(ctx, params.id) });
    return { ok: true };
  },
);
