import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { assertRecordInScope } from '@/lib/security/record-scope';
import { uploadMedia } from '@/services/inventory/media';

/**
 * Add photo / Add file on a listing (M12-02), as on a project. A listing is
 * its agent's: like PATCH, only a listing the caller may edit takes a file,
 * and one outside their scope answers 404.
 */
export const POST = route(
  {
    module: 'listings',
    productModule: LEAD_MODULES,
    action: 'EDIT',
    sessionOnly: true,
    params: z.object({ id: z.string().cuid() }),
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, params, req }) => {
    const listing = await prisma.listing.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, tenantId: true, ownerId: true },
    });
    if (!listing) throw NotFound('Listing');
    await assertRecordInScope(ctx, 'listings', listing, prisma, 'EDIT', 'Listing');
    return uploadMedia(ctx, req, { listing: listing.id });
  },
);
