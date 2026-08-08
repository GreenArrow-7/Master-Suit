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
    /** An object already in our bucket. */
    storageKey: z.string().max(500).optional(),
    /** A developer-hosted walkthrough or Matterport tour. */
    externalUrl: z.string().url().max(1000).optional(),
    mimeType: z.string().max(100).optional(),
    sizeBytes: z.number().int().positive().optional(),
    position: z.number().int().min(0).max(999).default(0),
  })
  .strict();

/**
 * Registers a piece of project media.
 *
 * Video and VR are `externalUrl` and nothing else: a 4 GB Matterport tour is
 * the developer's to host, to update and to take down, and copying it would
 * make us responsible for all three. Everything else is an object key in our
 * own bucket, so brochures and creatives keep the access control and the
 * signed-URL expiry that vendor links do not have.
 *
 * ponytail: this registers media, it does not receive bytes. Browser upload of
 * a brochure needs a multipart handler, which cannot go through the JSON API
 * kernel — copy the shape of
 * `api/v1/workspaces/[slug]/hr/documents/upload/route.ts` when someone needs to
 * drag a PDF in rather than have an importer place it.
 */
export const POST = route(
  {
    module: 'projects',
    productModule: 'SALES',
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
    productModule: 'SALES',
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
