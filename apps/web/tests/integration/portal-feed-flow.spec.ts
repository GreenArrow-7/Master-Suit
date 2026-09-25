import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTx } from '@/lib/db';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { buildFeed, newFeedKey } from '@/services/inventory/portals';
import { GET as feedRoute } from '@/app/api/v1/feeds/[workspaceSlug]/[feedKey]/route';
import { NextRequest } from 'next/server';

/**
 * The feed, end to end and against the real database.
 *
 * Two things are proved here that a unit test cannot. A feed is reachable by
 * something holding no session — that is the whole point of it — so the route
 * has to work outside the tenant guard's usual path without punching a hole in
 * it. And a feed must never carry another workspace's stock: these are
 * competitors in one city, and a leak here is their entire book.
 */

let fixture: Fixture;
let feedKey: string;

/** A listing complete enough that a portal would accept it. */
async function createListing(
  tenantId: string,
  over: { reference: string; permitNumber?: string | null; title?: string },
) {
  return withTx(tenantId, async (tx) => {
    // Every portal wants a community to place the pin. Created per tenant and
    // reused, so a listing made mid-suite is as complete as one made in setup.
    const micromarket =
      (await tx.micromarket.findFirst({ where: { tenantId }, select: { id: true } })) ??
      (await tx.micromarket.create({
        data: { tenantId, name: 'Dubai Marina', city: 'Dubai' },
        select: { id: true },
      }));

    const listing = await tx.listing.create({
      data: {
        tenantId,
        micromarketId: micromarket.id,
        reference: over.reference,
        title: over.title ?? 'Two bedroom with a marina view',
        description:
          'A bright two bedroom on a high floor with an open view, a fitted kitchen and covered parking.',
        listingType: 'SALE',
        status: 'ACTIVE',
        propertyType: 'APARTMENT',
        bedrooms: 2,
        bathrooms: 2,
        areaSqft: 1240,
        price: 2_150_000,
        currency: 'AED',
        permitNumber: over.permitNumber === undefined ? '7129834' : over.permitNumber,
      },
      select: { id: true },
    });

    // Two photographs, because the portals refuse fewer.
    for (const [position, key] of ['a.jpg', 'b.jpg'].entries()) {
      await tx.listingMedia.create({
        data: { tenantId, listingId: listing.id, kind: 'IMAGE', storageKey: key, position },
      });
    }

    await tx.listingPublication.create({
      data: {
        tenantId,
        listingId: listing.id,
        portal: 'BAYUT',
        isPublished: true,
        publishedAt: new Date(),
      },
    });

    return listing.id;
  });
}

beforeAll(async () => {
  fixture = await seedTwoTenants();

  feedKey = newFeedKey();
  await withTx(fixture.a.tenantId, (tx) =>
    tx.portalFeed.create({
      data: { tenantId: fixture.a.tenantId, portal: 'BAYUT', feedKey, isActive: true },
    }),
  );
}, 120_000);

afterAll(async () => {
  await fixture.cleanup();
  await prisma.$disconnect();
});

const request = (workspaceSlug: string, key: string) =>
  feedRoute(new NextRequest(new URL(`/api/v1/feeds/${workspaceSlug}/${key}`, 'http://localhost:3000')), {
    params: Promise.resolve({ workspaceSlug, feedKey: key }),
  });

describe('building a feed', () => {
  it('includes a listing that is ready, and records no complaint against it', async () => {
    const listingId = await createListing(fixture.a.tenantId, { reference: 'RDY-0001' });

    const built = await buildFeed(fixture.a.tenantId, 'BAYUT');
    expect(built.xml).toContain('RDY-0001');
    expect(built.included).toBeGreaterThan(0);

    const publication = await withTx(fixture.a.tenantId, (tx) =>
      tx.listingPublication.findFirst({
        where: { tenantId: fixture.a.tenantId, listingId },
        select: { lastError: true },
      }),
    );
    expect(publication?.lastError).toBeNull();
  }, 60_000);

  it('leaves out a listing with no permit, and writes the reason onto the pairing', async () => {
    const listingId = await createListing(fixture.a.tenantId, {
      reference: 'NOPERMIT-1',
      permitNumber: null,
    });

    const built = await buildFeed(fixture.a.tenantId, 'BAYUT');
    expect(built.xml).not.toContain('NOPERMIT-1');

    const publication = await withTx(fixture.a.tenantId, (tx) =>
      tx.listingPublication.findFirst({
        where: { tenantId: fixture.a.tenantId, listingId },
        select: { lastError: true },
      }),
    );
    // The agent should be able to read this and know what to do.
    expect(publication?.lastError).toMatch(/permit number/);
  }, 60_000);

  it('clears a complaint once it has been fixed', async () => {
    const listingId = await createListing(fixture.a.tenantId, {
      reference: 'FIXME-1',
      permitNumber: null,
    });
    await buildFeed(fixture.a.tenantId, 'BAYUT');

    await withTx(fixture.a.tenantId, (tx) =>
      tx.listing.updateMany({
        where: { id: listingId, tenantId: fixture.a.tenantId },
        data: { permitNumber: '7777777' },
      }),
    );
    await buildFeed(fixture.a.tenantId, 'BAYUT');

    const publication = await withTx(fixture.a.tenantId, (tx) =>
      tx.listingPublication.findFirst({
        where: { tenantId: fixture.a.tenantId, listingId },
        select: { lastError: true },
      }),
    );
    // A stale complaint about something already fixed is worse than none.
    expect(publication?.lastError).toBeNull();
  }, 60_000);

  it('records what it built, so the screen can say when and how many', async () => {
    await buildFeed(fixture.a.tenantId, 'BAYUT');
    const feed = await withTx(fixture.a.tenantId, (tx) =>
      tx.portalFeed.findFirstOrThrow({
        where: { tenantId: fixture.a.tenantId, portal: 'BAYUT' },
        select: { lastBuiltAt: true, lastItemCount: true },
      }),
    );
    expect(feed.lastBuiltAt).not.toBeNull();
    expect(feed.lastItemCount).toBeGreaterThan(0);
  }, 60_000);
});

describe('the public endpoint', () => {
  it('serves the feed as XML to a caller with no session', async () => {
    const response = await request(fixture.a.slug, feedKey);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('xml');
    // Every listing a brokerage holds, with prices. Not for an index.
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(await response.text()).toContain('<?xml');
  }, 60_000);

  it('refuses a key that does not exist, and one switched off', async () => {
    expect((await request(fixture.a.slug, 'not-a-real-feed-key-000000')).status).toBe(404);

    await withTx(fixture.a.tenantId, (tx) =>
      tx.portalFeed.updateMany({
        where: { tenantId: fixture.a.tenantId, portal: 'BAYUT' },
        data: { isActive: false },
      }),
    );
    expect((await request(fixture.a.slug, feedKey)).status).toBe(404);

    await withTx(fixture.a.tenantId, (tx) =>
      tx.portalFeed.updateMany({
        where: { tenantId: fixture.a.tenantId, portal: 'BAYUT' },
        data: { isActive: true },
      }),
    );
  }, 60_000);

  it('will not serve one workspace’s feed under another’s name', async () => {
    // The key is real; the workspace in the path is not its owner. These are
    // competitors in one city, so this is the test that matters most.
    const response = await request(fixture.b.slug, feedKey);
    expect(response.status).toBe(404);
  }, 60_000);

  it('never carries another workspace’s stock', async () => {
    await createListing(fixture.b.tenantId, { reference: 'RIVAL-0001', title: 'Rival villa' });
    await withTx(fixture.b.tenantId, (tx) =>
      tx.portalFeed.create({
        data: { tenantId: fixture.b.tenantId, portal: 'BAYUT', feedKey: newFeedKey(), isActive: true },
      }),
    );

    const body = await (await request(fixture.a.slug, feedKey)).text();
    expect(body).not.toContain('RIVAL-0001');
    expect(body).not.toContain('Rival villa');
  }, 60_000);
});
