import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Invalid, NotFound } from '@/lib/errors';

const params = z.object({ id: z.string().cuid() });

const KINDS = ['IMAGE', 'FLOOR_PLAN', 'BROCHURE', 'CREATIVE', 'VIDEO', 'VR_TOUR'] as const;

/** Embeds we point at rather than host. Anything else must be an object we hold. */
const EMBED_KINDS = new Set(['VIDEO', 'VR_TOUR']);

const createBody = z
  .object({
    kind: z.enum(KINDS),
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

    const isEmbed = EMBED_KINDS.has(body.kind);
    if (isEmbed && !body.externalUrl) {
      throw Invalid([{ field: 'externalUrl', code: 'required', message: 'A video or tour needs its URL.' }]);
    }
    if (!isEmbed && !body.storageKey) {
      throw Invalid([
        { field: 'storageKey', code: 'required', message: 'Upload the file first, then register its key.' },
      ]);
    }
    if (body.storageKey && body.externalUrl) {
      throw Invalid([
        {
          field: 'externalUrl',
          code: 'conflict',
          message: 'Media is either hosted by us or linked from elsewhere, not both.',
        },
      ]);
    }

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
