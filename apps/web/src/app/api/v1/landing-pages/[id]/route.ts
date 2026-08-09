import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';

const params = z.object({ id: z.string().cuid() });

const patchBody = z
  .object({ state: z.enum(['PUBLISHED', 'PAUSED', 'ARCHIVED']) })
  .strict();

export const PATCH = route(
  {
    module: 'landingpages',
    productModule: 'SALES',
    action: 'MANAGE_CONFIGURATION',
    params,
    body: patchBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    const page = await prisma.landingPage.findFirst({
      where: { tenantId: ctx.tenantId, id: params.id, deletedAt: null },
      select: { id: true, publishedAt: true },
    });
    if (!page) throw NotFound('Landing page');

    return prisma.landingPage.update({
      where: { id: page.id, tenantId: ctx.tenantId },
      data: {
        state: body.state,
        ...(body.state === 'PUBLISHED' && !page.publishedAt ? { publishedAt: new Date() } : {}),
        updatedById: ctx.actor.id,
      },
      select: { id: true, slug: true, state: true },
    });
  },
);
