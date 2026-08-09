import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Conflict } from '@/lib/errors';

const params = z.object({ id: z.string().cuid() });

const patchBody = z
  .object({ state: z.enum(['PUBLISHED', 'PAUSED', 'ARCHIVED']) })
  .strict();

export const PATCH = route(
  {
    module: 'automation',
    productModule: 'SALES',
    action: 'MANAGE_AUTOMATION',
    params,
    body: patchBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    const automation = await prisma.automation.findFirst({
      where: { tenantId: ctx.tenantId, id: params.id, deletedAt: null },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    if (!automation) throw NotFound('Automation');

    // Publishing needs a version to point at; the engine ignores automations
    // with no activeVersionId no matter what the state row claims.
    const latest = automation.versions[0];
    if (body.state === 'PUBLISHED' && !latest) throw Conflict('This automation has no version to publish.');

    return prisma.automation.update({
      where: { id: automation.id, tenantId: ctx.tenantId },
      data: {
        state: body.state,
        updatedById: ctx.actor.id,
        ...(body.state === 'PUBLISHED'
          ? { activeVersionId: automation.activeVersionId ?? latest!.id }
          : {}),
      },
      select: { id: true, state: true, activeVersionId: true },
    });
  },
);
