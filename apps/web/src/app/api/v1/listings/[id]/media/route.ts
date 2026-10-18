import { LEAD_MODULES } from '@/lib/security/entitlements';
import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { MEDIA_KINDS, assertMediaSource } from '@/lib/inventory/media';
import { assertRecordInScope } from '@/lib/security/record-scope';
import type { Ctx } from '@/lib/security/rbac';

const params = z.object({ id: z.string().cuid() });

const createBody = z
  .object({
    kind: z.enum(MEDIA_KINDS),
    title: z.string().max(200).optional(),
    externalUrl: z.string().url().max(1000).optional(),
    position: z.number().int().min(0).max(999).default(0),
  })
  .strict();

/** A listing is its agent's: like PATCH and the upload, one outside the caller's edit scope answers 404. */
async function editableListing(ctx: Ctx, id: string) {
  const listing = await prisma.listing.findFirst({
    where: { id, tenantId: ctx.tenantId, deletedAt: null },
    select: { id: true, tenantId: true, ownerId: true },
  });
  if (!listing) throw NotFound('Listing');
  await assertRecordInScope(ctx, 'listings', listing, prisma, 'EDIT', 'Listing');
  return listing;
}

/**
 * Links a video or tour to a listing. Same contract as project media, and the
 * rule is literally the same function: a photo, floor plan or brochure arrives
 * through `media/upload`, which recognises its type by its bytes.
 */
export const POST = route(
  {
    module: 'listings',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params,
    body: createBody,
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, params, body }) => {
    const listing = await editableListing(ctx, params.id);
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
    productModule: LEAD_MODULES,
    action: 'EDIT',
    params,
    query: deleteQuery,
    auditEvent: 'RECORD_DELETED',
  },
  async ({ ctx, params, query }) => {
    const listing = await editableListing(ctx, params.id);
    const { count } = await prisma.listingMedia.deleteMany({
      where: { id: query.mediaId, tenantId: ctx.tenantId, listingId: listing.id },
    });
    if (count === 0) throw NotFound('Media');
    // The object stays in the bucket for the retention job, so an accidental
    // delete here is recoverable for as long as that window lasts.
    return { deleted: count };
  },
);
