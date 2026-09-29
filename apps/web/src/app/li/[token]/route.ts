import { NextResponse, type NextRequest } from 'next/server';
import { withTx } from '@/lib/db';
import { getObject } from '@/lib/storage';
import { listingImageLink } from '@/lib/inventory/listingImageLink';

/**
 * A listing photograph for a caller with no session: `GET /li/{token}`.
 *
 * Exists because a portal crawler has to fetch the images in a feed and has
 * none of our credentials. The token carries the tenant and is signed, so the
 * lookup below is tenant-scoped exactly like an authenticated one — the bucket
 * itself stays private.
 *
 * Only IMAGE media resolves. The same table holds brochures and floor plans,
 * and a token minted for a listing's photograph should not become a way to
 * pull a document that was never meant to be public.
 */
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  const claim = listingImageLink.verify(token);
  if (!claim) return new NextResponse('Not found', { status: 404 });

  const media = await withTx(claim.tenantId, (tx) =>
    tx.listingMedia.findFirst({
      where: { id: claim.recordId, tenantId: claim.tenantId, kind: 'IMAGE' },
      select: { storageKey: true, mimeType: true, listing: { select: { deletedAt: true, status: true } } },
    }),
  );

  // A withdrawn or deleted listing stops serving its pictures. The feed will
  // have dropped it already; this is the same decision at the other end, for
  // links a portal cached earlier.
  if (!media?.storageKey || media.listing?.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }

  try {
    const body = await getObject(media.storageKey);
    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        'content-type': media.mimeType ?? 'image/jpeg',
        // Portals refetch images far more often than they change. A long
        // cache is the difference between serving a crawler once and serving
        // it every few hours for the life of the listing.
        'cache-control': 'public, max-age=86400, immutable',
        'x-robots-tag': 'noindex',
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
