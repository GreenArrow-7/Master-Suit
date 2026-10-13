const cookieJar = vi.hoisted(() => ({ value: '' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: cookieJar.value, 'x-pathname': '/' }),
  cookies: async () => ({
    get: (name: string) => {
      const match = cookieJar.value.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
      return match ? { name, value: match[1] } : undefined;
    },
  }),
}));

import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { PUT as saveRequirement } from '@/app/api/v1/leads/[id]/requirement/route';
import LeadDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import RequirementPage from '@/app/(workspace)/[workspaceSlug]/sales/requirements/[id]/page';
import { parseEnquiry, requirementFrom } from '@/lib/integrations/leadSources';
import { takeEnquiry } from '@/services/leads/intake';
import { matchesForRequirement } from '@/services/inventory/demand';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { pageText } from '../helpers/render';
import { put } from '../helpers/request';

/**
 * A lead's requirement on its own page (Lead Eagle audit rows M4-05, M4-08 and
 * M6-29, 13 Oct): purpose, property type and sub-type, bedrooms, budget in AED,
 * areas and the possession date, written from the lead's Overview under the
 * lead's own scope, and by intake when an enquiry states what it wants.
 */
let fixture: Fixture;
let tenantId: string;
let admin: string;
/** `leads:VIEW` and `EDIT` at OWN: reaches only the lead it owns. */
let agent: string;
let agentLeadId: string;

const url = (id: string) => `/api/v1/leads/${id}/requirement`;
const full = {
  purpose: 'BUY',
  propertyTypes: ['APARTMENT', 'PENTHOUSE'],
  subType: 'Duplex',
  bedroomsMin: 2,
  bedroomsMax: 3,
  budgetMin: 1_500_000,
  budgetMax: 2_500_000,
  locations: ['Dubai Marina', 'JLT'],
  possessionBy: '2027-03-01',
  notes: 'Sea view',
};
const open = (leadId: string) =>
  prisma.clientRequirement.findMany({ where: { tenantId, leadId, status: 'OPEN' }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  admin = fixture.a.cookie;
  cookieJar.value = admin;
  await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: 'Asia/Dubai' } });
  const suffix = randomBytes(4).toString('hex');
  const role = await prisma.role.create({ data: { tenantId, key: `agent-${suffix}`, name: 'Agent', rank: 80 } });
  await grantPermissions(
    tenantId,
    role.id,
    [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
    ],
    'OWN',
  );
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `agent-${suffix}@a.test`,
    fullName: 'Agent',
  });
  agent = await createSessionToken(tenantId, user.id);
  agentLeadId = (
    await prisma.lead.create({
      data: {
        tenantId,
        reference: `AG-${suffix}`,
        fullName: 'Agent Lead',
        stageId: fixture.a.stageId,
        ownerId: user.id,
      },
    })
  ).id;
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('the requirement composer on the lead page (M4-05, M4-08)', () => {
  it('saves purpose, type and sub-type, bedrooms, budget, areas and the possession date in the workspace time zone', async () => {
    const leadId = fixture.a.leadIds[0]!;
    const res = await put(saveRequirement, url(leadId), full, admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const [row, ...more] = await open(leadId);
    expect(more).toHaveLength(0);
    expect(row).toMatchObject({
      purpose: 'BUY',
      propertyTypes: ['APARTMENT', 'PENTHOUSE'],
      subType: 'Duplex',
      bedroomsMin: 2,
      bedroomsMax: 3,
      currency: 'AED',
      locations: ['Dubai Marina', 'JLT'],
      notes: 'Sea view',
      // The lead's owner works the requirement, as it works the lead.
      ownerId: fixture.a.userId,
    });
    expect(row!.budgetMin!.toString()).toBe('1500000');
    expect(row!.budgetMax!.toString()).toBe('2500000');
    // The end of 1 March in Dubai: a listing free any time that day qualifies.
    expect(row!.possessionBy!.toISOString()).toBe('2027-03-01T19:59:59.999Z');
    expect(
      await prisma.auditLog.findFirst({ where: { tenantId, objectType: 'requirement', recordId: row!.id } }),
    ).toMatchObject({ event: 'RECORD_CREATED', metadata: expect.objectContaining({ leadId }) });
  });

  it('edits that requirement in place; a new purpose closes it and starts another', async () => {
    const leadId = fixture.a.leadIds[0]!;
    const [before] = await open(leadId);
    const edited = await put(
      saveRequirement,
      url(leadId),
      { purpose: 'BUY', propertyTypes: ['VILLA'], budgetMax: 4_000_000 },
      admin,
    );
    expect(edited.status).toBe(200);
    const [after, ...more] = await open(leadId);
    expect(more).toHaveLength(0);
    expect(after).toMatchObject({
      id: before!.id,
      propertyTypes: ['VILLA'],
      subType: null,
      bedroomsMin: null,
      budgetMin: null,
      locations: [],
      possessionBy: null,
    });
    expect(
      await prisma.auditLog.findFirst({
        where: { tenantId, objectType: 'requirement', recordId: before!.id, event: 'RECORD_UPDATED' },
      }),
    ).not.toBeNull();

    // Renting instead is a different search: the buying one is kept, closed.
    expect((await put(saveRequirement, url(leadId), { purpose: 'RENT', budgetMax: 180_000 }, admin)).status).toBe(200);
    const [renting, ...others] = await open(leadId);
    expect(others).toHaveLength(0);
    expect(renting).toMatchObject({ purpose: 'RENT' });
    expect(await prisma.clientRequirement.findFirst({ where: { tenantId, id: before!.id } })).toMatchObject({
      status: 'CLOSED',
    });
  });

  it('refuses a budget or bedrooms upside down and a date that does not exist', async () => {
    const leadId = fixture.a.leadIds[1]!;
    for (const body of [
      { purpose: 'BUY', budgetMin: 3, budgetMax: 2 },
      { purpose: 'BUY', bedroomsMin: 4, bedroomsMax: 2 },
      { purpose: 'BUY', possessionBy: '2027-02-30' },
      { purpose: 'SELL' },
    ]) {
      expect((await put(saveRequirement, url(leadId), body, admin)).status, JSON.stringify(body)).toBe(422);
    }
    expect(await open(leadId)).toEqual([]);
  });

  it("follows the lead's scope: out of reach answers 404, like a missing lead", async () => {
    expect((await put(saveRequirement, url(fixture.a.leadIds[1]!), full, agent)).status).toBe(404);
    expect((await put(saveRequirement, url(fixture.a.leadIds[1]!), full, fixture.b.cookie)).status).toBe(404);
    expect((await put(saveRequirement, url(agentLeadId), full, agent)).status).toBe(200);
    expect(await open(fixture.a.leadIds[1]!)).toEqual([]);

    // Seeing the lead is not enough: writing its requirement is editing it.
    const suffix = randomBytes(4).toString('hex');
    const role = await prisma.role.create({ data: { tenantId, key: `viewer-${suffix}`, name: 'Viewer', rank: 80 } });
    await grantPermissions(tenantId, role.id, [['leads', 'VIEW']]);
    const user = await createWorkspaceUser({
      tenantId,
      roleId: role.id,
      email: `viewer-${suffix}@a.test`,
      fullName: 'Viewer',
    });
    const viewer = await createSessionToken(tenantId, user.id);
    expect((await put(saveRequirement, url(fixture.a.leadIds[1]!), full, viewer)).status).toBe(403);
    expect(await open(fixture.a.leadIds[1]!)).toEqual([]);
  });

  it('the lead page shows the requirement, its date as the workspace reads it', async () => {
    const leadId = fixture.a.leadIds[2]!;
    await put(saveRequirement, url(leadId), full, admin);
    const text = await pageText(LeadDetailPage({ params: Promise.resolve({ id: leadId }) }));
    for (const shown of ['Duplex', 'Dubai Marina', 'JLT', 'PENTHOUSE', '2027-03-01', 'Sea view']) {
      expect(text).toContain(shown);
    }
    // The link to its matches is offered only where the viewer may open the requirement.
    expect(text).not.toContain('/requirements/');

    // The register's own page shows the areas and the sub-type as well.
    const { roleId } = await prisma.user.findFirstOrThrow({
      where: { tenantId, id: fixture.a.userId },
      select: { roleId: true },
    });
    await grantPermissions(tenantId, roleId, [['requirements', 'VIEW']]);
    const [requirement] = await open(leadId);
    const withLink = await pageText(LeadDetailPage({ params: Promise.resolve({ id: leadId }) }));
    expect(withLink).toContain(`/requirements/${requirement!.id}`);
    const page = await pageText(RequirementPage({ params: Promise.resolve({ id: requirement!.id }) }));
    expect(page).toContain('Dubai Marina, JLT');
    expect(page).toContain('Duplex');
  });

  it("reads the possession date in the workspace's own time zone, not Dubai's", async () => {
    const leadId = fixture.a.leadIds[3]!;
    await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: 'America/New_York' } });
    try {
      const res = await put(saveRequirement, url(leadId), { purpose: 'BUY', possessionBy: '2027-03-01' }, admin);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const [row] = await open(leadId);
      // The end of 1 March in New York (UTC-5 until mid-March).
      expect(row!.possessionBy!.toISOString()).toBe('2027-03-02T04:59:59.999Z');
      const text = await pageText(LeadDetailPage({ params: Promise.resolve({ id: leadId }) }));
      expect(text).toContain('2027-03-01');
      expect(text).not.toContain('2027-03-02');
    } finally {
      await prisma.tenant.update({ where: { id: tenantId }, data: { timezone: 'Asia/Dubai' } });
    }
  });

  it('the possession date is matched against when a listing is available (M4-08)', async () => {
    const [requirement] = await open(fixture.a.leadIds[2]!);
    const listing = (availableFrom: string, title: string) =>
      prisma.listing.create({
        data: {
          tenantId,
          reference: `LS-${randomBytes(3).toString('hex')}`,
          title,
          listingType: 'SALE',
          status: 'ACTIVE',
          propertyType: 'APARTMENT',
          bedrooms: 2,
          price: 2_000_000,
          availableFrom: new Date(availableFrom),
        },
      });
    await listing('2027-03-01', 'Free on the day');
    await listing('2027-04-01', 'Free a month late');
    const result = await matchesForRequirement(tenantId, requirement!.id);
    expect(result!.matches.map((m) => m.title)).toEqual(['Free on the day']);
  });
});

describe('an enquiry that says what it wants writes the requirement (M4-05, M6-29)', () => {
  const pf = (extra: Record<string, unknown>) => ({
    event: 'lead.created',
    data: {
      lead_id: `pf-${randomBytes(4).toString('hex')}`,
      client: { name: 'Requirement Client', phone: `050${String(Date.now()).slice(-7)}` },
      ...extra,
    },
  });
  const origin = { label: 'Property Finder', source: 'MARKETPLACE' as const, sourceDetail: 'property_finder' };

  it('reads purpose, type, sub-type, area, bedrooms and budget as the portals word them', () => {
    expect(
      requirementFrom({
        purpose: 'Sale',
        type: 'Villa',
        area: 'Arabian Ranches',
        bedrooms: '4',
        budget: 'AED 3,500,000',
      }),
    ).toEqual({
      purpose: 'BUY',
      propertyTypes: ['VILLA'],
      subType: null,
      locations: ['Arabian Ranches'],
      bedroomsMin: 4,
      bedroomsMax: 4,
      budgetMin: null,
      budgetMax: 3_500_000,
    });
    expect(
      requirementFrom({
        purpose: 'Rent',
        type: 'Hotel Apartment',
        area: 'JLT',
        bedrooms: 'Studio',
        budget: '60k - 80k',
      }),
    ).toEqual({
      purpose: 'RENT',
      propertyTypes: ['APARTMENT'],
      subType: 'Hotel Apartment',
      locations: ['JLT'],
      bedroomsMin: 0,
      bedroomsMax: 0,
      budgetMin: 60_000,
      budgetMax: 80_000,
    });
    expect(requirementFrom({ purpose: 'RR', type: 'Duplex', bedrooms: '3+', budget: '1.5M' })).toMatchObject({
      purpose: 'RENT',
      propertyTypes: [],
      subType: 'Duplex',
      bedroomsMin: 3,
      bedroomsMax: null,
      budgetMax: 1_500_000,
    });
    // An owner wanting to sell is not a search; and an enquiry that says nothing wants nothing.
    expect(requirementFrom({ purpose: 'Sell', type: 'Villa' })).toBeNull();
    expect(requirementFrom({})).toBeNull();
    // A budget with no purpose is taken as buying.
    expect(requirementFrom({ budget: '2,000,000' })).toMatchObject({ purpose: 'BUY', budgetMax: 2_000_000 });
    // An amount no budget column holds (the composer's own ceiling is 1e12) is left out, not stored.
    expect(requirementFrom({ type: 'Villa', budget: 'AED 50000000000000000' })).toMatchObject({
      propertyTypes: ['VILLA'],
      budgetMin: null,
      budgetMax: null,
    });
    expect(requirementFrom({ budget: '999999999999 million' })).toBeNull();
    expect(requirementFrom({ budget: '9'.repeat(400) })).toBeNull();
  });

  it('an enquiry with a budget no column can hold still becomes a lead', async () => {
    const result = await takeEnquiry(
      tenantId,
      parseEnquiry(pf({ property_type: 'Villa', budget: 'AED 50000000000000000' })),
      origin,
    );
    expect(result).toMatchObject({ created: true });
    const [row, ...more] = await open((result as { leadId: string }).leadId);
    expect(more).toHaveLength(0);
    expect(row).toMatchObject({ propertyTypes: ['VILLA'], budgetMin: null, budgetMax: null });
  });

  it('a repeat enquiry that says what it wants writes the requirement the first did not', async () => {
    const client = { name: 'Repeat Client', phone: `052${String(Date.now()).slice(-7)}` };
    const first = await takeEnquiry(tenantId, parseEnquiry(pf({ client, message: 'Call me' })), origin);
    const leadId = (first as { leadId: string }).leadId;
    expect(await open(leadId)).toEqual([]);

    const again = await takeEnquiry(
      tenantId,
      parseEnquiry(pf({ client, offering_type: 'Rent', budget: '120k' })),
      origin,
    );
    expect(again).toMatchObject({ leadId, created: false });
    const [row, ...more] = await open(leadId);
    expect(more).toHaveLength(0);
    expect(row).toMatchObject({ purpose: 'RENT' });
    expect(row!.budgetMax!.toString()).toBe('120000');
  });

  it('a Property Finder enquiry with a budget produces a requirement row, shown on the lead page and matched', async () => {
    const enquiry = parseEnquiry(
      pf({
        offering_type: 'Sale',
        property_type: 'Villa',
        community: 'Arabian Ranches',
        bedrooms: 4,
        budget: 'AED 3,500,000',
      }),
    );
    const result = await takeEnquiry(tenantId, enquiry, origin);
    expect(result).toMatchObject({ created: true });
    const leadId = (result as { leadId: string }).leadId;
    const [row, ...more] = await open(leadId);
    expect(more).toHaveLength(0);
    expect(row).toMatchObject({
      purpose: 'BUY',
      propertyTypes: ['VILLA'],
      locations: ['Arabian Ranches'],
      bedroomsMin: 4,
      bedroomsMax: 4,
      ownerId: null,
    });
    expect(row!.budgetMax!.toString()).toBe('3500000');
    expect(
      await prisma.auditLog.findFirst({
        where: { tenantId, objectType: 'requirement', recordId: row!.id, actorUserId: null },
      }),
    ).toMatchObject({ event: 'RECORD_CREATED' });

    const text = await pageText(LeadDetailPage({ params: Promise.resolve({ id: leadId }) }));
    expect(text).toContain('Arabian Ranches');

    await prisma.listing.create({
      data: {
        tenantId,
        reference: `LS-${randomBytes(3).toString('hex')}`,
        title: 'Ranches villa',
        listingType: 'SALE',
        status: 'ACTIVE',
        propertyType: 'VILLA',
        bedrooms: 4,
        price: 3_200_000,
      },
    });
    expect((await matchesForRequirement(tenantId, row!.id))!.matches.map((m) => m.title)).toContain('Ranches villa');

    // The same person again: the enquiry attaches, and the requirement is not written twice.
    const again = await takeEnquiry(tenantId, { ...enquiry, details: enquiry.details }, origin);
    expect(again).toMatchObject({ leadId, created: false });
    expect(await open(leadId)).toHaveLength(1);
  });

  it('an enquiry that states nothing it wants writes none', async () => {
    const result = await takeEnquiry(tenantId, parseEnquiry(pf({ message: 'Call me' })), origin);
    expect(await open((result as { leadId: string }).leadId)).toEqual([]);
  });
});

describe('matching stock on the lead Overview (M4-48)', () => {
  it('lists the live listings its open requirement matches, to a role that sees listings, with the full list a click away', async () => {
    const suffix = randomBytes(4).toString('hex');
    const role = await prisma.role.create({ data: { tenantId, key: `stock-${suffix}`, name: 'Stock', rank: 80 } });
    await grantPermissions(tenantId, role.id, [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
      ['listings', 'VIEW'],
      ['requirements', 'VIEW'],
    ]);
    const user = await createWorkspaceUser({
      tenantId,
      roleId: role.id,
      email: `stock-${suffix}@a.test`,
      fullName: 'Stock',
    });
    const stock = await createSessionToken(tenantId, user.id);
    const lead = await prisma.lead.create({
      data: { tenantId, reference: `MS-${suffix}`, fullName: 'Stock Lead', stageId: fixture.a.stageId },
    });
    const villa = (title: string, data: Record<string, unknown> = {}) =>
      prisma.listing.create({
        data: {
          tenantId,
          reference: `MS-${randomBytes(3).toString('hex')}`,
          title,
          listingType: 'SALE',
          status: 'ACTIVE',
          propertyType: 'VILLA',
          bedrooms: 5,
          price: 4_500_000,
          ...data,
        },
      });
    const palm = await villa(`Palm villa ${suffix}`);
    await villa(`Rented villa ${suffix}`, { listingType: 'RENT', rentFrequency: 'YEARLY', price: 450_000 });
    await villa(`Pricey villa ${suffix}`, { price: 9_000_000 });
    await villa(`Lapsed villa ${suffix}`, { mandateExpires: new Date(Date.now() - 86_400_000) });
    await villa(`Sold villa ${suffix}`, { status: 'SOLD' });

    /** What the page hands the lead screen, as this viewer. */
    const shown = async (as: string) => {
      cookieJar.value = as;
      try {
        const tree = (await LeadDetailPage({ params: Promise.resolve({ id: lead.id }) })) as {
          props: { children: ({ props?: Record<string, any> } | null)[] };
        };
        return tree.props.children.find((child) => child?.props?.lead)!.props!;
      } finally {
        cookieJar.value = admin;
      }
    };

    // No requirement yet: the card asks for one.
    expect((await shown(stock)).lead.matchingStock).toEqual({
      hasRequirement: false,
      total: 0,
      more: false,
      listings: [],
    });

    expect(
      (
        await put(
          saveRequirement,
          url(lead.id),
          { purpose: 'BUY', propertyTypes: ['VILLA'], bedroomsMin: 5, budgetMax: 5_000_000 },
          admin,
        )
      ).status,
    ).toBe(200);
    const [requirement] = await open(lead.id);

    const seen = await shown(stock);
    const titles = seen.lead.matchingStock.listings.map((l: { title: string }) => l.title);
    expect(titles).toContain(`Palm villa ${suffix}`);
    expect(seen.lead.matchingStock.listings.find((l: { id: string }) => l.id === palm.id)).toMatchObject({
      reference: palm.reference,
      price: 'AED 4,500,000',
      bedrooms: 5,
    });
    for (const left of ['Rented villa', 'Pricey villa', 'Lapsed villa', 'Sold villa']) {
      expect(titles).not.toContain(`${left} ${suffix}`);
    }
    // The full match list is the requirement's page.
    expect(seen.matchesHref).toBe(`/requirements/${requirement!.id}`);

    // A role that does not see listings is shown none.
    const blind = await shown(admin);
    expect(blind.lead.matchingStock).toBeNull();
    expect(await pageText(LeadDetailPage({ params: Promise.resolve({ id: lead.id }) }))).not.toContain(
      `Palm villa ${suffix}`,
    );

    // More than the card reads: it says so, rather than giving the cap as the count.
    expect(seen.lead.matchingStock).toMatchObject({ more: false });
    await prisma.listing.createMany({
      data: Array.from({ length: 26 }, (_, i) => ({
        tenantId,
        reference: `MT-${suffix}-${i}`,
        title: `Townhouse ${i} ${suffix}`,
        listingType: 'SALE' as const,
        status: 'ACTIVE' as const,
        propertyType: 'TOWNHOUSE' as const,
        bedrooms: 7,
        price: 3_000_000 + i,
      })),
    });
    expect(
      (
        await put(
          saveRequirement,
          url(lead.id),
          { purpose: 'BUY', propertyTypes: ['TOWNHOUSE'], bedroomsMin: 7 },
          admin,
        )
      ).status,
    ).toBe(200);
    expect((await shown(stock)).lead.matchingStock).toMatchObject({ total: 25, more: true });
  });
});
