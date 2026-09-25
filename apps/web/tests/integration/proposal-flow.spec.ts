import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTx } from '@/lib/db';
import type { PermissionMap } from '@/lib/security/rbac';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { buildActor, buildCtx } from '../helpers/ctx';
import { closeProposal, createProposal, proposalDetail, sendProposal } from '@/services/proposals/proposals';
import { loadProposal, react, recordView } from '@/lib/proposals/publicProposal';
import { proposalLink } from '@/lib/proposals/proposalLink';
import { AppError } from '@/lib/errors';

/**
 * A proposal end to end, against the real database.
 *
 * The parts worth proving here are the ones a unit test cannot reach: that a
 * draft is not reachable by anybody holding a link, that a client's answer
 * comes back to the agency, and that a token for one workspace cannot be bent
 * into reading another's — these are competing brokerages in one city, and a
 * client's shortlist is their pipeline.
 */

let fixture: Fixture;

function ctxFor(tenant: { tenantId: string; userId: string }) {
  return buildCtx(
    buildActor({
      id: tenant.userId,
      tenantId: tenant.tenantId,
      permissions: new Map([
        ['requirements:VIEW', 'ORGANIZATION'],
        ['requirements:CREATE', 'ORGANIZATION'],
        ['requirements:EDIT', 'ORGANIZATION'],
      ]) as PermissionMap,
    }),
  );
}

async function createListing(tenantId: string, reference: string, status = 'ACTIVE') {
  return withTx(tenantId, async (tx) => {
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
        reference,
        title: `Two bedroom ${reference}`,
        description: 'A bright two bedroom on a high floor with an open view.',
        listingType: 'SALE',
        status: status as 'ACTIVE',
        propertyType: 'APARTMENT',
        bedrooms: 2,
        bathrooms: 2,
        areaSqft: 1240,
        price: 2_150_000,
        currency: 'AED',
        permitNumber: '7129834',
      },
      select: { id: true },
    });

    await tx.listingMedia.create({
      data: { tenantId, listingId: listing.id, kind: 'IMAGE', storageKey: `${reference}.jpg`, position: 0 },
    });
    return listing.id;
  });
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('proposals', () => {
  it('builds a shortlist, and a draft opens for nobody', async () => {
    const ctx = ctxFor(fixture.a);
    const listingIds = [await createListing(ctx.tenantId, 'A-1'), await createListing(ctx.tenantId, 'A-2')];

    const proposal = await createProposal(ctx, {
      leadId: fixture.a.leadIds[0]!,
      title: 'A few places in the Marina',
      message: 'The second one is the closer walk to the tram.',
      listingIds,
    });
    expect(proposal.itemCount).toBe(2);
    expect(proposal.status).toBe('DRAFT');

    // The link is computable before it is sent — deriving it is the whole
    // scheme — so "not yet sent" has to be enforced where it is read.
    await expect(loadProposal(proposalLink.token(ctx.tenantId, proposal.id))).rejects.toThrow(AppError);
  });

  it('sends it, and the client can open it', async () => {
    const ctx = ctxFor(fixture.a);
    const listingIds = [await createListing(ctx.tenantId, 'A-3')];
    const created = await createProposal(ctx, {
      leadId: fixture.a.leadIds[0]!,
      title: 'One to look at',
      listingIds,
    });

    const { url } = await sendProposal(ctx, created.id);
    const token = url.split('/p/')[1]!;

    const view = await loadProposal(token);
    expect(view.title).toBe('One to look at');
    expect(view.listings).toHaveLength(1);
    expect(view.listings[0]!.permitNumber).toBe('7129834');
    // A signed image path, not a bucket URL: the crawler and the client both
    // get the picture without the bucket being public.
    expect(view.listings[0]!.images[0]).toMatch(/^\/li\//);

    // What the client must never see.
    expect(JSON.stringify(view)).not.toContain('mandate');
    expect(JSON.stringify(view)).not.toContain(fixture.a.leadIds[0]!);
  });

  it('counts opens, and remembers the first separately from the last', async () => {
    const ctx = ctxFor(fixture.a);
    const created = await createProposal(ctx, {
      leadId: fixture.a.leadIds[1]!,
      title: 'Counted',
      listingIds: [await createListing(ctx.tenantId, 'A-4')],
    });
    const { url } = await sendProposal(ctx, created.id);
    const token = url.split('/p/')[1]!;

    const first = new Date('2026-09-20T09:00:00Z');
    await recordView(await loadProposal(token), first);
    await recordView(await loadProposal(token), new Date('2026-09-24T18:00:00Z'));

    const detail = await proposalDetail(ctx, created.id);
    expect(detail.viewCount).toBe(2);
    expect(detail.firstViewedAt?.toISOString()).toBe(first.toISOString());
    expect(detail.lastViewedAt?.toISOString()).toBe('2026-09-24T18:00:00.000Z');
  });

  it('carries the client’s answer back to the agency, and lets them change it', async () => {
    const ctx = ctxFor(fixture.a);
    const created = await createProposal(ctx, {
      leadId: fixture.a.leadIds[1]!,
      title: 'Answered',
      listingIds: [await createListing(ctx.tenantId, 'A-5'), await createListing(ctx.tenantId, 'A-6')],
    });
    const { url } = await sendProposal(ctx, created.id);
    const token = url.split('/p/')[1]!;

    const view = await loadProposal(token);
    await react(token, view.listings[0]!.itemId, 'INTERESTED', null);
    await react(token, view.listings[1]!.itemId, 'NOT_INTERESTED', '  Too far from the metro  ');

    const detail = await proposalDetail(ctx, created.id);
    expect(detail.items[0]!.reaction).toBe('INTERESTED');
    expect(detail.items[1]!.reaction).toBe('NOT_INTERESTED');
    // Trimmed, because a comment is quoted back to an agent verbatim.
    expect(detail.items[1]!.comment).toBe('Too far from the metro');
    expect(detail.items[1]!.reactedAt).not.toBeNull();

    // They looked again on a bigger screen.
    await react(token, view.listings[1]!.itemId, null, null);
    const second = await proposalDetail(ctx, created.id);
    expect(second.items[1]!.reaction).toBeNull();
    expect(second.items[1]!.reactedAt).toBeNull();
  });

  it('refuses an answer for a property that is not on this proposal', async () => {
    const ctx = ctxFor(fixture.a);
    const mine = await createProposal(ctx, {
      leadId: fixture.a.leadIds[1]!,
      title: 'Mine',
      listingIds: [await createListing(ctx.tenantId, 'A-7')],
    });
    const other = await createProposal(ctx, {
      leadId: fixture.a.leadIds[1]!,
      title: 'Somebody else’s',
      listingIds: [await createListing(ctx.tenantId, 'A-8')],
    });
    const { url } = await sendProposal(ctx, mine.id);
    await sendProposal(ctx, other.id);

    const otherView = await loadProposal((await sendProposal(ctx, other.id)).url.split('/p/')[1]!);
    await expect(
      react(url.split('/p/')[1]!, otherView.listings[0]!.itemId, 'INTERESTED', null),
    ).rejects.toThrow(AppError);
  });

  it('drops a property that has gone, even from a link already sent', async () => {
    const ctx = ctxFor(fixture.a);
    const staying = await createListing(ctx.tenantId, 'A-9');
    const going = await createListing(ctx.tenantId, 'A-10');
    const created = await createProposal(ctx, {
      leadId: fixture.a.leadIds[1]!,
      title: 'One will go',
      listingIds: [staying, going],
    });
    const { url } = await sendProposal(ctx, created.id);
    const token = url.split('/p/')[1]!;
    expect((await loadProposal(token)).listings).toHaveLength(2);

    await withTx(ctx.tenantId, (tx) =>
      tx.listing.updateMany({ where: { id: going, tenantId: ctx.tenantId }, data: { status: 'SOLD' } }),
    );

    const after = await loadProposal(token);
    expect(after.listings).toHaveLength(1);
    expect(after.listings[0]!.title).toContain('A-9');
  });

  it('stops resolving once it expires, and once it is withdrawn', async () => {
    const ctx = ctxFor(fixture.a);
    const created = await createProposal(ctx, {
      leadId: fixture.a.leadIds[1]!,
      title: 'Short-lived',
      listingIds: [await createListing(ctx.tenantId, 'A-11')],
      expiresAt: new Date('2026-09-30T00:00:00Z'),
    });
    const { url } = await sendProposal(ctx, created.id);
    const token = url.split('/p/')[1]!;

    await expect(loadProposal(token, new Date('2026-09-29T00:00:00Z'))).resolves.toBeTruthy();
    await expect(loadProposal(token, new Date('2026-10-01T00:00:00Z'))).rejects.toThrow(AppError);

    await closeProposal(ctx, created.id);
    await expect(loadProposal(token)).rejects.toThrow(AppError);

    // The record and the answers survive the withdrawal: "they liked the third
    // one" is worth more after the proposal is dead than during it.
    const detail = await proposalDetail(ctx, created.id);
    expect(detail.status).toBe('CLOSED');
    expect(detail.url).toBeNull();
  });

  it('re-sending does not restart the clock on a link the client already has', async () => {
    const ctx = ctxFor(fixture.a);
    const created = await createProposal(ctx, {
      leadId: fixture.a.leadIds[1]!,
      title: 'Sent twice',
      listingIds: [await createListing(ctx.tenantId, 'A-12')],
    });
    await sendProposal(ctx, created.id, new Date('2026-09-01T10:00:00Z'));
    await sendProposal(ctx, created.id, new Date('2026-09-20T10:00:00Z'));

    const detail = await proposalDetail(ctx, created.id);
    expect(detail.sentAt?.toISOString()).toBe('2026-09-01T10:00:00.000Z');
  });

  it('refuses a property from another workspace rather than putting it on the page', async () => {
    const ctx = ctxFor(fixture.a);
    const theirs = await createListing(fixture.b.tenantId, 'B-1');
    const mine = await createListing(ctx.tenantId, 'A-13');

    const created = await createProposal(ctx, {
      leadId: fixture.a.leadIds[1]!,
      title: 'Mixed',
      listingIds: [mine, theirs],
    });
    expect(created.itemCount).toBe(1);
    expect(created.skipped).toBe(1);
  });

  /**
   * Two brokerages in one city. The signature covers the tenant, so a token
   * cannot be re-pointed — but that is the property worth a test rather than a
   * comment, because it is the one that carries the isolation.
   */
  it('cannot be bent into reading another workspace’s proposal', async () => {
    const ctxA = ctxFor(fixture.a);
    const ctxB = ctxFor(fixture.b);

    const theirs = await createProposal(ctxB, {
      leadId: fixture.b.leadIds[0]!,
      title: 'Their client',
      listingIds: [await createListing(ctxB.tenantId, 'B-2')],
    });
    await sendProposal(ctxB, theirs.id);

    // Their proposal id, our tenant: the signature does not cover this pair.
    const forged = `${ctxA.tenantId}.${theirs.id}.${proposalLink.token(ctxB.tenantId, theirs.id).split('.')[2]}`;
    await expect(loadProposal(forged)).rejects.toThrow(AppError);

    // And their own valid token does not become readable through our workspace.
    await expect(proposalDetail(ctxA, theirs.id)).rejects.toThrow(AppError);
  });

  it('will not send an empty proposal', async () => {
    const ctx = ctxFor(fixture.a);
    const proposal = await withTx(ctx.tenantId, (tx) =>
      tx.proposal.create({
        data: { tenantId: ctx.tenantId, leadId: fixture.a.leadIds[1]!, title: 'Nothing on it' },
        select: { id: true },
      }),
    );
    await expect(sendProposal(ctx, proposal.id)).rejects.toThrow(AppError);
  });
});
