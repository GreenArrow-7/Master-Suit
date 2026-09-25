import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { buildFeed, newFeedKey } from '@/services/inventory/portals';
import type { PortalKey } from '@/lib/inventory/portalFeed';

/**
 * The feeds a brokerage offers, and the switches on them.
 *
 * Gated on the listing book's own permissions rather than a settings one:
 * deciding what is advertised, and where, belongs to whoever runs the book.
 *
 * Reading needs EDIT rather than VIEW, because the address is a credential —
 * anyone holding it can read every published listing and its asking price, so
 * it is not for the whole floor.
 */
const PORTALS = ['PROPERTY_FINDER', 'BAYUT', 'DUBIZZLE', 'WEBSITE'] as const;

export const GET = route(
  { module: 'listings', productModule: 'SALES', action: 'EDIT' },
  async ({ ctx }) =>
    withTx(ctx.tenantId, async (tx) => {
      // The slug is not on Ctx and the feed address needs it.
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { slug: true },
      });
      const feeds = await tx.portalFeed.findMany({
        where: { tenantId: ctx.tenantId },
        select: {
          portal: true,
          feedKey: true,
          isActive: true,
          lastBuiltAt: true,
          lastItemCount: true,
        },
      });

      return {
        portals: PORTALS.map((portal) => {
          const feed = feeds.find((row) => row.portal === portal);
          return {
            portal,
            isActive: feed?.isActive ?? false,
            // The address is only meaningful once the feed is live, and a key
            // shown for a switched-off feed is a key somebody pastes anyway.
            path: feed?.isActive ? `/api/v1/feeds/${tenant.slug}/${feed.feedKey}` : null,
            lastBuiltAt: feed?.lastBuiltAt ?? null,
            lastItemCount: feed?.lastItemCount ?? 0,
          };
        }),
      };
    }),
);

const patchBody = z.object({
  portal: z.enum(PORTALS),
  /** Exactly one of these per request — a switch, a rotation, or a rebuild. */
  isActive: z.boolean().optional(),
  rotateKey: z.literal(true).optional(),
  rebuild: z.literal(true).optional(),
});

export const PATCH = route(
  { module: 'listings', productModule: 'SALES', action: 'EDIT', body: patchBody },
  async ({ ctx, body }) => {
    const portal = body.portal as PortalKey;

    const { feed, slug } = await withTx(ctx.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { slug: true },
      });
      const existing = await tx.portalFeed.findFirst({
        where: { tenantId: ctx.tenantId, portal },
        select: { id: true },
      });

      if (!existing) {
        const created = await tx.portalFeed.create({
          data: {
            tenantId: ctx.tenantId,
            portal,
            feedKey: newFeedKey(),
            isActive: body.isActive ?? false,
          },
          select: { feedKey: true, isActive: true },
        });
        return { feed: created, slug: tenant.slug };
      }

      const data: { isActive?: boolean; feedKey?: string } = {};
      if (body.isActive !== undefined) data.isActive = body.isActive;
      if (body.rotateKey) data.feedKey = newFeedKey();

      await tx.portalFeed.updateMany({
        where: { id: existing.id, tenantId: ctx.tenantId },
        data,
      });

      const updated = await tx.portalFeed.findFirstOrThrow({
        where: { id: existing.id, tenantId: ctx.tenantId },
        select: { feedKey: true, isActive: true },
      });
      return { feed: updated, slug: tenant.slug };
    });

    // Built on demand so somebody can see what a portal will see without
    // waiting hours for the portal to ask.
    const built = body.rebuild ? await buildFeed(ctx.tenantId, portal) : null;

    return {
      portal,
      isActive: feed.isActive,
      path: feed.isActive ? `/api/v1/feeds/${slug}/${feed.feedKey}` : null,
      included: built?.included ?? null,
    };
  },
);
