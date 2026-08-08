import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Invalid, NotFound } from '@/lib/errors';
import { getObject } from '@/lib/storage';

const params = z.object({ id: z.string().cuid(), mediaId: z.string().cuid() });

/**
 * The bytes of a listing photograph, floor plan or brochure.
 *
 * Streamed through an authorised handler rather than handed out as a pre-signed
 * bucket URL — the same rule the project media and the call recordings follow.
 * A listing photo is not sensitive on its own, but the rule is cheaper to keep
 * than to carve exceptions into.
 */
export const GET = route(
  { module: 'listings', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const media = await prisma.listingMedia.findFirst({
      where: { id: params.mediaId, tenantId: ctx.tenantId, listingId: params.id },
      select: { storageKey: true, mimeType: true, title: true, kind: true },
    });
    if (!media) throw NotFound('Media');
    if (!media.storageKey) {
      throw Invalid([
        { field: 'media', code: 'external', message: 'This item is hosted elsewhere — open its link instead.' },
      ]);
    }

    const body = await getObject(media.storageKey);
    const filename = (media.title ?? media.kind.toLowerCase()).replace(/["\\]/g, '');

    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': media.mimeType ?? 'application/octet-stream',
        'content-length': String(body.byteLength),
        'content-disposition': `inline; filename="${filename}"`,
        'cache-control': 'private, max-age=300',
      },
    });
  },
);
