import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';

const params = z.object({ id: z.string().cuid() });

const patchBody = z
  .object({
    state: z.enum(['PUBLISHED', 'PAUSED', 'ARCHIVED']).optional(),
    name: z.string().min(2).max(160).optional(),
    successMessage: z.string().max(300).optional(),
  })
  .strict();

export const PATCH = route(
  {
    module: 'forms',
    productModule: 'SALES',
    action: 'MANAGE_CONFIGURATION',
    params,
    body: patchBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    const form = await prisma.form.findFirst({
      where: { tenantId: ctx.tenantId, id: params.id, deletedAt: null },
      select: { id: true },
    });
    if (!form) throw NotFound('Form');

    return prisma.form.update({
      where: { id: form.id, tenantId: ctx.tenantId },
      data: {
        ...body,
        // A published form is public by definition here; pausing or archiving
        // takes it off the air in the same stroke.
        ...(body.state ? { isPublic: body.state === 'PUBLISHED' } : {}),
        updatedById: ctx.actor.id,
      },
      select: { id: true, key: true, state: true, isPublic: true },
    });
  },
);
