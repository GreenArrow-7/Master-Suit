import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { buildFeed } from '@/services/inventory/portals';
import type { PortalKey } from '@/lib/inventory/portalFeed';

/**
 * The feed a portal fetches: `GET /api/v1/feeds/{workspace}/{feedKey}`.
 *
 * Public, because the crawler has none of our credentials — the key is the
 * credential, which is why it is long, random, and rotatable per feed without
 * touching any other public link in the product.
 *
 * The workspace is in the path for the same reason it is in the public form's:
 * the tenant is resolved first from a global model, then everything else is
 * queried with that tenantId, so the unauthenticated path is scoped exactly
 * like an authenticated one rather than needing an exception in the tenant
 * guard. It also makes the address self-describing for whoever pastes it into
 * a portal's back office.
 *
 * Built on request rather than cached. Portals fetch every few hours, a
 * brokerage has hundreds of listings rather than millions, and a stale file is
 * the thing agents complain about.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, context: { params: Promise<{ workspaceSlug: string; feedKey: string }> }) {
  const { workspaceSlug, feedKey } = await context.params;

  const tenant = await prisma.tenant.findFirst({
    where: { slug: workspaceSlug, status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });
  if (!tenant) return new NextResponse('Not found', { status: 404 });

  const feed = await prisma.portalFeed.findFirst({
    where: { tenantId: tenant.id, feedKey, isActive: true },
    select: { portal: true },
  });
  // One answer for a wrong workspace, a wrong key and a switched-off feed.
  // Telling them apart turns this into an oracle for which brokerages exist.
  if (!feed) return new NextResponse('Not found', { status: 404 });

  const built = await buildFeed(tenant.id, feed.portal as PortalKey);

  return new NextResponse(built.xml, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'x-robots-tag': 'noindex, nofollow',
      // A portal retrying after a blip should never be served a stale file,
      // and there is nothing here worth a CDN holding on to.
      'cache-control': 'no-store',
    },
  });
}
