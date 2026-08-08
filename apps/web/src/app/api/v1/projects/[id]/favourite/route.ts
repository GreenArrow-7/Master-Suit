import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';

const params = z.object({ id: z.string().cuid() });

/**
 * Toggle, not separate add and remove routes.
 *
 * The UI has one star. Two endpoints would mean the client tracking which one to
 * call, and getting it wrong on a stale render — a star that un-stars something
 * already un-starred. One idempotent-by-outcome endpoint cannot desynchronise.
 *
 * `VIEW` rather than `EDIT`: favouriting is a personal bookmark on reference
 * data, not a change to the catalogue. Requiring EDIT would mean only ops could
 * bookmark, which is backwards — the salespeople are the ones who need it.
 */
export const POST = route(
  { module: 'projects', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const project = await prisma.project.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw NotFound('Project');

    const existing = await prisma.projectFavourite.findFirst({
      where: { tenantId: ctx.tenantId, projectId: project.id, userId: ctx.actor.id },
      select: { id: true },
    });

    if (existing) {
      await prisma.projectFavourite.deleteMany({ where: { id: existing.id, tenantId: ctx.tenantId } });
      return { projectId: project.id, isFavourite: false };
    }

    await prisma.projectFavourite.create({
      data: { tenantId: ctx.tenantId, projectId: project.id, userId: ctx.actor.id },
    });
    return { projectId: project.id, isFavourite: true };
  },
);
