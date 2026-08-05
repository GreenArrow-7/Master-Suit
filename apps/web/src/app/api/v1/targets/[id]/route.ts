import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const patchBody = z.object({
  targetValue: z.number().int().positive().optional(),
  periodEnd: z.coerce.date().optional(),
}).strict();

export const PATCH = route(
  { module: 'leads', action: 'ASSIGN', body: patchBody, params: z.object({ id: z.string() }), auditEvent: 'TARGET_UPDATED' },
  async ({ ctx, params, body }) => {
    return prisma.employeeTarget.update({
      where: { id: params.id, tenantId: ctx.tenantId },
      data: body,
    });
  },
);

export const DELETE = route(
  { module: 'leads', action: 'ASSIGN', params: z.object({ id: z.string() }) },
  async ({ ctx, params }) => {
    await prisma.employeeTarget.delete({
      where: { id: params.id, tenantId: ctx.tenantId },
    });
    return { ok: true };
  },
);
