const request = vi.hoisted(() => ({ cookie: '', agent: 'Phone A' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: request.cookie, 'x-pathname': '/', 'user-agent': request.agent }),
  cookies: async () => ({
    get: (name: string) => {
      const match = request.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? { name, value: match[1] } : undefined;
    },
  }),
}));

import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { invalidateEntitlements } from '@/lib/security/entitlements';
import { clear, consume, limits } from '@/lib/security/ratelimit';
import { proposalLink } from '@/lib/proposals/proposalLink';
import { DELETE as revokeShare, POST as shareWithLead } from '@/app/api/v1/leads/[id]/shares/route';
import { GET as readTimeline } from '@/app/api/v1/leads/[id]/timeline/route';
import SharePage from '@/app/s/[token]/page';
import { POST as viewed } from '@/app/api/v1/public/share-view/route';
import { LOGGED_PER_DAY, loadShare, recordShareView } from '@/services/leads/leadShares';
import LeadDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import ListingDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/listings/[id]/page';
import ProjectDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/projects/[id]/page';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { pageText } from '../helpers/render';
import { del, get, post } from '../helpers/request';

/**
 * Sharing a project or a listing with a lead (Lead Eagle audit row M4-30): a
 * signed public page per share, showing only what an advert would, that logs
 * an opening on the lead's timeline once per visitor per day. A share lapses
 * or is revoked; any other token is a 404, and the page is rate-limited as
 * the public forms are.
 */
let fixture: Fixture;
let tenantId: string;
let admin: string;
let leadId: string;
let listingId: string;
let projectId: string;
/** `leads:VIEW` and `EDIT` at OWN, and the stock: reaches only its own leads. */
let agent: string;
/** Every lead, editing them, without the sensitive fields: numbers masked. */
let masked: string;

const SELLER = 'Seller Person';
const SELLER_PHONE = '+971509990000';
const LEAD_PHONE = '+971501234567';

const shareUrl = (id: string) => `/api/v1/leads/${id}/shares`;
const share = async (as: string, id: string, body: Record<string, unknown>) =>
  post(shareWithLead, shareUrl(id), body, as, { id });
const tokenOf = (url: string) => url.split('/s/')[1]!;
const open = (token: string, visitor = 'Phone A') => {
  request.agent = visitor;
  return SharePage({ params: Promise.resolve({ token }) });
};
/** The page's script reporting an opening, from a browser with no session unless one is given. */
const beacon = async (token: string, visitor = 'Phone A', cookie = '') => {
  // The session is read from the request, then from next/headers: neither may carry the administrator's.
  request.cookie = cookie;
  try {
    const res = await viewed(
      new Request('http://localhost/api/v1/public/share-view', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': visitor, ...(cookie && { cookie }) },
        body: JSON.stringify({ token }),
      }),
      { params: Promise.resolve({}) },
    );
    return res.status;
  } finally {
    request.cookie = admin;
  }
};
const views = (id = leadId) =>
  prisma.activity.findMany({
    where: { tenantId, leadId: id, type: { key: 'link_view' } },
    orderBy: { createdAt: 'asc' },
  });

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  admin = fixture.a.cookie;
  request.cookie = admin;
  await prisma.moduleEntitlement.updateMany({ where: { tenantId, module: 'SALES' }, data: { state: 'CANCELED' } });
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  await invalidateEntitlements(tenantId);
  await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: 'Asia/Dubai' } });

  const adminRoleId = (
    await prisma.user.findFirstOrThrow({ where: { tenantId, id: fixture.a.userId }, select: { roleId: true } })
  ).roleId!;
  await grantPermissions(tenantId, adminRoleId, [
    ['projects', 'VIEW'],
    ['listings', 'VIEW'],
  ]);
  const suffix = randomBytes(4).toString('hex');
  const role = await prisma.role.create({ data: { tenantId, key: `agent-${suffix}`, name: 'Agent', rank: 80 } });
  await grantPermissions(
    tenantId,
    role.id,
    [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
      ['listings', 'VIEW'],
      ['projects', 'VIEW'],
    ],
    'OWN',
  );
  const agentUser = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `agent-${suffix}@a.test`,
    fullName: 'Share Agent',
  });
  agent = await createSessionToken(tenantId, agentUser.id);
  const maskedRole = await prisma.role.create({
    data: { tenantId, key: `masked-${suffix}`, name: 'Masked', rank: 80 },
  });
  await grantPermissions(tenantId, maskedRole.id, [
    ['leads', 'VIEW'],
    ['leads', 'EDIT'],
    ['listings', 'VIEW'],
  ]);
  const maskedUser = await createWorkspaceUser({
    tenantId,
    roleId: maskedRole.id,
    email: `masked-${suffix}@a.test`,
    fullName: 'Masked Sharer',
  });
  masked = await createSessionToken(tenantId, maskedUser.id);

  leadId = fixture.a.leadIds[0]!;
  await prisma.lead.update({
    where: { tenantId, id: leadId },
    data: { fullName: 'Sara Ahmed', phone: LEAD_PHONE, phoneNormalized: LEAD_PHONE },
  });

  const marina = await prisma.micromarket.create({ data: { tenantId, name: 'Dubai Marina', city: 'Dubai' } });
  const seller = await prisma.owner.create({ data: { tenantId, fullName: SELLER, phone: SELLER_PHONE } });
  listingId = (
    await prisma.listing.create({
      data: {
        tenantId,
        reference: 'INT-REF-77',
        title: 'Marina view two-bed',
        listingType: 'SALE',
        status: 'ACTIVE',
        propertyType: 'APARTMENT',
        propertyOwnerId: seller.id,
        micromarketId: marina.id,
        address: 'Tower 5, Apt 1203',
        bedrooms: 2,
        bathrooms: 3,
        areaSqft: 1450,
        price: 2400000,
        currency: 'AED',
        description: 'Full sea view, upgraded kitchen.',
        permitNumber: '7123456789',
        mandateType: 'EXCLUSIVE',
      },
    })
  ).id;
  await prisma.listingMedia.create({ data: { tenantId, listingId, kind: 'IMAGE', storageKey: 'listing/photo-1.jpg' } });
  const developer = await prisma.developer.create({ data: { tenantId, name: 'Harbour Developments' } });
  projectId = (
    await prisma.project.create({
      data: {
        tenantId,
        name: 'Marina Vista',
        code: 'MV-INTERNAL-9',
        developerId: developer.id,
        micromarketId: marina.id,
        possessionStatus: 'UNDER_CONSTRUCTION',
        possessionAt: new Date('2027-12-15T00:00:00Z'),
        minPrice: 1200000,
        maxPrice: 3500000,
        currency: 'AED',
        unitTypes: ['1BR', '2BR'],
        highlights: ['Private beach'],
        description: 'Waterfront towers.',
        reraNumber: 'RERA-555',
        totalUnits: 400,
        availableUnits: 37,
      },
    })
  ).id;
});

afterAll(async () => {
  await clear(limits.publicShare('unknown'));
  await fixture.cleanup();
});

/** The props of the first element in a rendered tree that carries a prop named `key`. */
function propsWith(node: unknown, key: string): Record<string, any> | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = propsWith(child, key);
      if (found) return found;
    }
    return undefined;
  }
  const props = (node as { props?: Record<string, any> }).props;
  if (!props) return undefined;
  return key in props ? props : propsWith(props.children, key);
}

describe('a listing or a project shared with a lead (M4-30)', () => {
  let listingToken: string;
  let shareId: string;

  it('makes a signed link for the lead, audited', async () => {
    const res = await share(admin, leadId, { listingId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ kind: 'listing', title: 'Marina view two-bed' });
    expect(res.body.url).toMatch(new RegExp(`/s/${tenantId}\\.[a-z0-9]+\\.[A-Za-z0-9_-]{27}$`));
    listingToken = tokenOf(res.body.url);
    shareId = res.body.id;

    const row = await prisma.leadShare.findFirstOrThrow({ where: { tenantId, id: shareId } });
    expect(row).toMatchObject({ leadId, listingId, projectId: null, createdById: fixture.a.userId, revokedAt: null });
    // Thirty days unless said otherwise.
    expect(Math.round((row.expiresAt.getTime() - row.createdAt.getTime()) / 86_400_000)).toBe(30);
    expect(
      await prisma.auditLog.count({
        where: { tenantId, event: 'RECORD_CREATED', objectType: 'lead-share', recordId: shareId },
      }),
    ).toBe(1);
  });

  it('the page shows the listing as an advert would, and nothing of the seller, the lead or the desk', async () => {
    const text = await pageText(open(listingToken));
    for (const shown of [
      'Marina view two-bed',
      'AED 2,400,000',
      '2 bed',
      '3 bath',
      '1,450 sq ft',
      'Dubai Marina, Dubai',
      'Full sea view, upgraded kitchen.',
      'Permit 7123456789',
      'Shared by manath Administrator',
    ]) {
      expect(text).toContain(shown);
    }
    for (const hidden of [SELLER, SELLER_PHONE, 'Sara Ahmed', LEAD_PHONE, 'INT-REF-77', 'Tower 5', 'EXCLUSIVE']) {
      expect(text).not.toContain(hidden);
    }
    // Its photographs through the signed image route, never the bucket.
    expect(text).toMatch(/\/li\/[^\s]+/);
    expect(text).not.toContain('listing/photo-1.jpg');
  });

  it('a project page shows the project, not its code or its stock counts', async () => {
    const res = await share(admin, leadId, { projectId, days: 7 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const text = await pageText(open(tokenOf(res.body.url)));
    for (const shown of [
      'Marina Vista',
      'Harbour Developments',
      'Dubai Marina, Dubai',
      'From AED 1,200,000',
      'Under construction',
      'Dec 2027',
      '1BR',
      'Private beach',
      'Waterfront towers.',
      'RERA-555',
    ]) {
      expect(text).toContain(shown);
    }
    for (const hidden of ['MV-INTERNAL-9', 'Sara Ahmed']) expect(text).not.toContain(hidden);
    // The stock counts (400 units, 37 left) are the desk's, not the client's.
    expect(text).not.toMatch(/\b(400|37)\b/);
  });

  it('an opening is logged by the page’s script, once per visitor per day, without the visitor, and shows on the timeline', async () => {
    await prisma.activity.deleteMany({ where: { tenantId, leadId, type: { key: 'link_view' } } });
    const row = () => prisma.leadShare.findFirstOrThrow({ where: { tenantId, id: shareId } });
    // The page itself counts nothing: WhatsApp fetches it for the link preview as the agent sends it, and runs no script.
    await pageText(open(listingToken, 'WhatsApp/2.24.1 A'));
    expect((await row()).viewCount).toBe(0);
    expect(await views()).toEqual([]);

    expect(await beacon(listingToken, 'Phone B')).toBe(200);
    await beacon(listingToken, 'Phone B');
    await beacon(listingToken, 'Laptop C');
    const logged = await views();
    expect(logged).toHaveLength(2);
    expect(logged[0]).toMatchObject({ ownerId: null, notes: 'Listing: Marina view two-bed' });
    expect(JSON.stringify(logged)).not.toMatch(/Phone B|Laptop C/);
    // Every opening counts on the share.
    expect((await row()).viewCount).toBe(3);
    expect((await row()).lastViewedAt).not.toBeNull();

    // The workspace looking at its own link (the agent's Open, signed in) is no opening.
    expect(await beacon(listingToken, 'Agent laptop', admin)).toBe(200);
    expect((await row()).viewCount).toBe(3);
    expect(await views()).toHaveLength(2);

    const timeline = await get(readTimeline, `/api/v1/leads/${leadId}/timeline`, admin, { id: leadId });
    expect(timeline.body.entries[0]).toMatchObject({
      kind: 'activity',
      title: 'Shared link opened',
      notes: 'Listing: Marina view two-bed',
      by: null,
    });
    // Audited as the system: nobody in the workspace opened it.
    expect(
      await prisma.auditLog.count({
        where: { tenantId, actorType: 'SYSTEM', objectType: 'activity', recordId: { in: logged.map((a) => a.id) } },
      }),
    ).toBe(2);
  });

  it('a lapsed link, a revoked one and a listing off the market are a 404', async () => {
    const lapsing = await share(admin, leadId, { listingId });
    await prisma.leadShare.update({
      where: { tenantId, id: lapsing.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(open(tokenOf(lapsing.body.url))).rejects.toThrow(/;404$/);

    const revoked = await del(revokeShare, `${shareUrl(leadId)}?share=${shareId}`, admin, { id: leadId });
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
    await expect(open(listingToken)).rejects.toThrow(/;404$/);
    expect(
      await prisma.auditLog.count({
        where: { tenantId, event: 'RECORD_UPDATED', objectType: 'lead-share', recordId: shareId },
      }),
    ).toBe(1);

    const live = await share(admin, leadId, { listingId });
    await prisma.listing.update({ where: { tenantId, id: listingId }, data: { status: 'SOLD' } });
    await expect(open(tokenOf(live.body.url))).rejects.toThrow(/;404$/);
    await prisma.listing.update({ where: { tenantId, id: listingId }, data: { status: 'ACTIVE' } });
    await expect(pageText(open(tokenOf(live.body.url)))).resolves.toContain('Marina view two-bed');
  });

  it('any other token is a 404: altered, another link kind, or another workspace', async () => {
    const live = await share(admin, leadId, { listingId });
    const token = tokenOf(live.body.url);
    const [tenant, id, signature] = token.split('.');
    const altered = `${tenant}.${id}.${signature!.slice(0, -1)}${signature!.endsWith('A') ? 'B' : 'A'}`;
    await expect(open(altered)).rejects.toThrow(/;404$/);
    await expect(open(proposalLink.token(tenant!, id!))).rejects.toThrow(/;404$/);
    await expect(open(`${fixture.b.tenantId}.${id}.${signature}`)).rejects.toThrow(/;404$/);
    await expect(open('not-a-token')).rejects.toThrow(/;404$/);
    // A broken escape in a made-up one too, not a server error.
    await expect(open('%E0%A4%A')).rejects.toThrow(/;404$/);
    // The page's report of an opening answers a bad token as the page does.
    expect(await beacon(altered)).toBe(404);
  });

  it('is 404 once the workspace has no lead module', async () => {
    const live = await share(admin, leadId, { listingId });
    const where = { tenantId_module: { tenantId, module: 'LEAD_EAGLE' as const } };
    await prisma.moduleEntitlement.update({ where, data: { state: 'CANCELED' } });
    await invalidateEntitlements(tenantId);
    try {
      await expect(open(tokenOf(live.body.url))).rejects.toThrow(/;404$/);
    } finally {
      await prisma.moduleEntitlement.update({ where, data: { state: 'ACTIVE' } });
      await invalidateEntitlements(tenantId);
    }
  });

  it('the lead page lists its links; WhatsApp only through a number the viewer reads, never to an opted-out lead', async () => {
    const sharing = async (as: string) => {
      request.cookie = as;
      try {
        return propsWith(await LeadDetailPage({ params: Promise.resolve({ id: leadId }) }), 'sharing')?.sharing;
      } finally {
        request.cookie = admin;
      }
    };
    const offered = await sharing(admin);
    expect(offered.whatsapp).toBe('https://wa.me/971501234567');
    expect(offered.shares.find((row: { id: string }) => row.id === shareId)).toMatchObject({
      title: 'Marina view two-bed',
      kind: 'listing',
      views: 3,
      live: false,
    });
    expect((await sharing(masked)).whatsapp).toBeNull();
    await prisma.lead.update({ where: { tenantId, id: leadId }, data: { whatsappOptOut: true } });
    try {
      expect((await sharing(admin)).whatsapp).toBeNull();
    } finally {
      await prisma.lead.update({ where: { tenantId, id: leadId }, data: { whatsappOptOut: false } });
    }
  });

  it('shares only a lead in scope, and only stock the sharer sees and may show', async () => {
    // Another's lead: 404, as a missing one.
    expect((await share(agent, leadId, { listingId })).status).toBe(404);
    expect((await share(admin, fixture.b.leadIds[0]!, { listingId })).status).toBe(404);
    // Another workspace's listing, and one not on the market.
    const theirs = await prisma.listing.create({
      data: {
        tenantId: fixture.b.tenantId,
        reference: 'B-1',
        title: 'Theirs',
        listingType: 'SALE',
        status: 'ACTIVE',
        price: 1,
      },
    });
    expect((await share(admin, leadId, { listingId: theirs.id })).status).toBe(404);
    const draft = await prisma.listing.create({
      data: { tenantId, reference: 'D-1', title: 'Draft', listingType: 'SALE', status: 'DRAFT', price: 1 },
    });
    const refused = await share(admin, leadId, { listingId: draft.id });
    expect(refused.status).toBe(409);
    expect(refused.body.detail).toBe('That listing is not on the market.');
    expect((await share(admin, leadId, { listingId, projectId })).status).toBe(422);
  });

  it('a link logs at most three openings a day however many browsers, and again the next day; nobody logs one by hand', async () => {
    const other = fixture.a.leadIds[1]!;
    const live = await share(admin, other, { listingId });
    const loaded = await loadShare(tokenOf(live.body.url));
    for (const browser of ['A', 'B', 'C', 'D', 'E']) await recordShareView(loaded, `unknown|${browser}`);
    expect(await views(other)).toHaveLength(LOGGED_PER_DAY);
    // Tomorrow, a browser seen today is an opening again.
    await recordShareView(loaded, 'unknown|A', new Date(Date.now() + 86_400_000));
    expect(await views(other)).toHaveLength(LOGGED_PER_DAY + 1);
    expect((await prisma.leadShare.findFirstOrThrow({ where: { tenantId, id: live.body.id } })).viewCount).toBe(6);

    // Its activity type is not in the lead page's Log activity menu.
    expect(
      (await prisma.activityType.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key: 'link_view' } } }))
        .isActive,
    ).toBe(false);
  });

  it('takes 1 to 90 days, revokes only the lead’s own links, and shares only a project offered to clients', async () => {
    for (const days of [0, 91]) expect((await share(admin, leadId, { listingId, days })).status).toBe(422);
    const other = fixture.a.leadIds[1]!;
    const theirs = await share(admin, other, { listingId });
    const wrong = await del(revokeShare, `${shareUrl(leadId)}?share=${theirs.body.id}`, admin, { id: leadId });
    expect(wrong.status).toBe(404);
    expect((await prisma.leadShare.findFirstOrThrow({ where: { tenantId, id: theirs.body.id } })).revokedAt).toBeNull();

    const projectLink = await share(admin, leadId, { projectId });
    await prisma.project.update({ where: { tenantId, id: projectId }, data: { isPitchable: false } });
    try {
      const refused = await share(admin, leadId, { projectId });
      expect(refused.status).toBe(409);
      expect(refused.body.detail).toBe('That project is not offered to clients.');
      // A link made while it was offered stops with it.
      await expect(open(tokenOf(projectLink.body.url))).rejects.toThrow(/;404$/);
    } finally {
      await prisma.project.update({ where: { tenantId, id: projectId }, data: { isPitchable: true } });
    }
    // Without projects:VIEW, a project is as missing.
    expect((await share(masked, leadId, { projectId })).status).toBe(404);
  });

  it('is rate-limited as the public forms are', async () => {
    const live = await share(admin, leadId, { listingId });
    const limit = limits.publicShare('unknown');
    await clear(limit);
    for (let i = 0; i < limit.max; i++) await consume(limit);
    const text = await pageText(open(tokenOf(live.body.url)));
    expect(text).toContain('Too many requests');
    expect(text).not.toContain('Marina view two-bed');
    await clear(limit);
  });

  it('a share is on the lead’s timeline, as the sharer’s, the moment it is made (M10-09)', async () => {
    const res = await share(admin, leadId, { projectId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sharer = await prisma.user.findFirstOrThrow({ where: { tenantId, id: fixture.a.userId } });
    const timeline = await get(readTimeline, `/api/v1/leads/${leadId}/timeline`, admin, { id: leadId });
    expect(timeline.body.entries[0]).toMatchObject({
      kind: 'activity',
      title: 'Property shared',
      notes: 'Project: Marina Vista',
      by: sharer.fullName,
    });
    // Nobody logs one by hand from the lead page.
    expect(
      (await prisma.activityType.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key: 'link_shared' } } }))
        .isActive,
    ).toBe(false);
  });

  it('answers WhatsApp with the link written, to a number the sharer reads, never to an opted-out lead (M10-09)', async () => {
    const res = await share(admin, leadId, { listingId });
    const text = `Hi Sara, here are the details of Marina view two-bed: ${res.body.url}`;
    expect(res.body.whatsapp).toBe(`https://wa.me/971501234567?text=${encodeURIComponent(text)}`);
    expect((await share(masked, leadId, { listingId })).body.whatsapp).toBeNull();
    await prisma.lead.update({ where: { tenantId, id: leadId }, data: { whatsappOptOut: true } });
    try {
      expect((await share(admin, leadId, { listingId })).body.whatsapp).toBeNull();
    } finally {
      await prisma.lead.update({ where: { tenantId, id: leadId }, data: { whatsappOptOut: false } });
    }
  });

  it('the listing and the project pages offer Share with a lead, for stock on the market and a sharer who may (M10-09)', async () => {
    const offered = async (as: string, page: () => Promise<unknown>) => {
      request.cookie = as;
      try {
        return propsWith(await page(), 'shareTarget')?.shareTarget;
      } finally {
        request.cookie = admin;
      }
    };
    const listingPage = () => ListingDetailPage({ params: Promise.resolve({ id: listingId, workspaceSlug: 'a' }) });
    const projectPage = () => ProjectDetailPage({ params: Promise.resolve({ id: projectId }) });
    expect(await offered(admin, listingPage)).toEqual({ listingId });
    expect(await offered(admin, projectPage)).toEqual({ projectId });

    // A role that reads the stock and the leads but does not work them: no Share.
    const suffix = randomBytes(4).toString('hex');
    const role = await prisma.role.create({ data: { tenantId, key: `looker-${suffix}`, name: 'Looker', rank: 80 } });
    await grantPermissions(tenantId, role.id, [
      ['leads', 'VIEW'],
      ['listings', 'VIEW'],
      ['projects', 'VIEW'],
    ]);
    const looker = await createWorkspaceUser({
      tenantId,
      roleId: role.id,
      email: `looker-${suffix}@a.test`,
      fullName: 'Stock Looker',
    });
    const lookerCookie = await createSessionToken(tenantId, looker.id);
    expect(await offered(lookerCookie, listingPage)).toBeUndefined();
    expect(await offered(lookerCookie, projectPage)).toBeUndefined();

    // Off the market: nothing to share.
    await prisma.listing.update({ where: { tenantId, id: listingId }, data: { status: 'SOLD' } });
    await prisma.project.update({ where: { tenantId, id: projectId }, data: { isPitchable: false } });
    try {
      expect(await offered(admin, listingPage)).toBeUndefined();
      expect(await offered(admin, projectPage)).toBeUndefined();
    } finally {
      await prisma.listing.update({ where: { tenantId, id: listingId }, data: { status: 'ACTIVE' } });
      await prisma.project.update({ where: { tenantId, id: projectId }, data: { isPitchable: true } });
    }
  });
});
