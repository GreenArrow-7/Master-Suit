import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { MEDIA_KINDS, assertMediaSource } from '@/lib/inventory/media';

const params = z.object({ id: z.string().cuid() });

const createBody = z
  .object({
    kind: z.enum(MEDIA_KINDS),
    title: z.string().max(200).optional(),
    /** A developer-hosted walkthrough or Matterport tour. */
    externalUrl: z.string().url().max(1000).optional(),
    position: z.number().int().min(0).max(999).default(0),
  })
  .strict();

/**
 * Links a video or VR tour to a project.
 *
 * Video and VR are `externalUrl` and nothing else: a 4 GB Matterport tour is
 * the developer's to host, to update and to take down, and copying it would
 * make us responsible for all three. Everything else is a file in our own
 * bucket, and its row comes from `media/upload`, which recognises the type by
 * its bytes — so no caller names a key or a type here.
 */
export const POST = route(
  {
    module: 'projects',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params,
    body: createBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, params, body }) => {
    const project = await prisma.project.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw NotFound('Project');

    // Shared with the listing media route: the embed-versus-hosted rule is the
    // same in both places, and two copies of it is how they come to disagree.
    assertMediaSource(body);

    return prisma.projectMedia.create({
      data: { tenantId: ctx.tenantId, projectId: project.id, createdById: ctx.actor.id, ...body },
    });
  },
);

const deleteQuery = z.object({ mediaId: z.string().cuid() }).strict();

export const DELETE = route(
  {
    module: 'projects',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params,
    query: deleteQuery,
    auditEvent: 'RECORD_DELETED',
  },
  async ({ ctx, params, query }) => {
    const { count } = await prisma.projectMedia.deleteMany({
      where: { id: query.mediaId, tenantId: ctx.tenantId, projectId: params.id },
    });
    if (count === 0) throw NotFound('Media');
    // The object itself is left in the bucket for the retention job, so an
    // accidental delete here is recoverable for as long as that window lasts.
    return { deleted: count };
  },
);
