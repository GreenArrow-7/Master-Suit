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
    storageKey: z.string().max(500).optional(),
    externalUrl: z.string().url().max(1000).optional(),
    mimeType: z.string().max(100).optional(),
    sizeBytes: z.number().int().positive().optional(),
    position: z.number().int().min(0).max(999).default(0),
  })
  .strict();

/**
 * Registers a photograph, floor plan, brochure or tour against a listing.
 *
 * Same contract as project media, and the embed-versus-hosted rule is literally
 * the same function. As there, this registers media rather than receiving bytes:
 * browser upload needs a multipart handler outside the JSON kernel — copy
 * `hr/documents/upload/route.ts` when somebody needs to drag a photo in.
 */
export const POST = route(
  {
    module: 'listings',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body: createBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, params, body }) => {
    const listing = await prisma.listing.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!listing) throw NotFound('Listing');

    assertMediaSource(body);

    return prisma.listingMedia.create({
      data: { tenantId: ctx.tenantId, listingId: listing.id, createdById: ctx.actor.id, ...body },
    });
  },
);

const deleteQuery = z.object({ mediaId: z.string().cuid() }).strict();

export const DELETE = route(
  {
    module: 'listings',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    query: deleteQuery,
    auditEvent: 'RECORD_DELETED',
  },
  async ({ ctx, params, query }) => {
    const { count } = await prisma.listingMedia.deleteMany({
      where: { id: query.mediaId, tenantId: ctx.tenantId, listingId: params.id },
    });
    if (count === 0) throw NotFound('Media');
    // The object stays in the bucket for the retention job, so an accidental
    // delete here is recoverable for as long as that window lasts.
    return { deleted: count };
  },
);
