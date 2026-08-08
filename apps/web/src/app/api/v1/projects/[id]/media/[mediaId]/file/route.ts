import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Invalid, NotFound } from '@/lib/errors';
import { getObject } from '@/lib/storage';

const params = z.object({ id: z.string().cuid(), mediaId: z.string().cuid() });

/**
 * The bytes of a hosted brochure, creative, floor plan or gallery image.
 *
 * Streamed through an authorised handler rather than handed out as a pre-signed
 * bucket URL, for the same reason call recordings are: a pre-signed link works
 * for whoever obtains it, survives the permission being revoked, and leaves no
 * record of who read it. A brochure is not as sensitive as a recording, but the
 * rule is cheaper to keep than to make exceptions to.
 *
 * Embeds have no bytes here by design — a video or VR tour is the developer's
 * URL and is linked, not proxied.
 */
export const GET = route(
  { module: 'projects', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const media = await prisma.projectMedia.findFirst({
      where: { id: params.mediaId, tenantId: ctx.tenantId, projectId: params.id },
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
        // `inline` so a gallery image renders and a brochure previews, but with
        // a filename so a download keeps a sensible name. Images are the whole
        // point of the gallery, so `attachment` here would break the page.
        'content-disposition': `inline; filename="${filename}"`,
        // Marketing material changes rarely; the access check still runs every
        // time because the cache is private to the browser that passed it.
        'cache-control': 'private, max-age=300',
      },
    });
  },
);
