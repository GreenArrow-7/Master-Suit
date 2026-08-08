import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { listingWhere, listingFilters, maskOwner } from '@/lib/inventory/listings';
import { listingsMatching, matchesForRequirement, requirementsWanting } from '@/services/inventory/demand';
import { canTransition, createMandate, decideMandate, expireLapsedMandates } from '@/services/inventory/mandates';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import type { Ctx } from '@/lib/security/rbac';

/**
 * The three things in M5 that are not CRUD: the mandate that permits marketing,
 * the expiry that ends it, and the demand check read from both directions.
 */
let fixture: Fixture;
let ownerId: string;
let micromarketId: string;

const DAY = 86_400_000;
const filters = (over: Record<string, unknown> = {}) => listingFilters.parse(over);

async function makeListing(over: Record<string, unknown> = {}) {
  return prisma.listing.create({
    data: {
      tenantId: fixture.a.tenantId,
      reference: `LS-${Math.random().toString(36).slice(2, 10)}`,
      title: 'Marina two bed',
      listingType: 'SALE',
      propertyType: 'APARTMENT',
      propertyOwnerId: ownerId,
      micromarketId,
      bedrooms: 2,
      areaSqft: 1_200,
      price: new Prisma.Decimal(1_800_000),
      ownerId: fixture.a.userId,
      ...over,
    },
  });
}

async function makeRequirement(over: Record<string, unknown> = {}) {
  return prisma.clientRequirement.create({
    data: {
      tenantId: fixture.a.tenantId,
      leadId: fixture.a.leadIds[0],
      purpose: 'BUY',
      ownerId: fixture.a.userId,
      ...over,
    },
  });
}

const mandateWindow = (days = 90) => ({
  startsAt: new Date(Date.now() - DAY),
  expiresAt: new Date(Date.now() + days * DAY),
});

beforeAll(async () => {
  fixture = await seedTwoTenants();

  const owner = await prisma.owner.create({
    data: {
      tenantId: fixture.a.tenantId,
      fullName: 'Yusuf Rahman',
      phone: '+971501234567',
      phoneNormalized: '+971501234567',
      email: 'yusuf@example.com',
    },
    select: { id: true },
  });
  ownerId = owner.id;

  const mm = await prisma.micromarket.create({
    data: { tenantId: fixture.a.tenantId, name: 'Marina', city: 'Dubai' },
    select: { id: true },
  });
  micromarketId = mm.id;
});

afterAll(async () => {
  const tenants = [fixture.a.tenantId, fixture.b.tenantId];
  await prisma.clientRequirement.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.listing.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.owner.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.micromarket.deleteMany({ where: { tenantId: { in: tenants } } });
  await fixture.cleanup();
});

// ── Mandates ─────────────────────────────────────────────────────────────────
describe('the mandate state machine', () => {
  it('permits only the moves that do not rewrite history', () => {
    expect(canTransition('DRAFT', 'ACTIVE')).toBe(true);
    expect(canTransition('ACTIVE', 'TERMINATED')).toBe(true);
    expect(canTransition('ACTIVE', 'EXPIRED')).toBe(true);

    // A lapsed agreement is replaced, never revived — reviving it would erase
    // the gap in which the agency had no right to market the property.
    expect(canTransition('EXPIRED', 'ACTIVE')).toBe(false);
    expect(canTransition('TERMINATED', 'ACTIVE')).toBe(false);
    expect(canTransition('DRAFT', 'EXPIRED')).toBe(false);
  });

  it('mirrors the live mandate onto the listing so the book can filter on it', async () => {
    const listing = await makeListing();
    const { expiresAt } = mandateWindow();

    await createMandate({
      tenantId: fixture.a.tenantId,
      actorId: fixture.a.userId,
      listingId: listing.id,
      ownerId,
      type: 'EXCLUSIVE',
      ...mandateWindow(),
      activate: true,
    });

    const after = await prisma.listing.findFirstOrThrow({
      where: { id: listing.id, tenantId: fixture.a.tenantId },
      select: { mandateType: true, mandateExpires: true },
    });
    expect(after.mandateType).toBe('EXCLUSIVE');
    expect(after.mandateExpires?.toISOString().slice(0, 10)).toBe(expiresAt.toISOString().slice(0, 10));
  });

  it('refuses a second live mandate on the same property', async () => {
    const listing = await makeListing();
    await createMandate({
      tenantId: fixture.a.tenantId,
      actorId: fixture.a.userId,
      listingId: listing.id,
      ownerId,
      type: 'EXCLUSIVE',
      ...mandateWindow(),
      activate: true,
    });

    // An exclusive and an open agreement cannot both be true, and whichever the
    // report reads first would win.
    await expect(
      createMandate({
        tenantId: fixture.a.tenantId,
        actorId: fixture.a.userId,
        listingId: listing.id,
        ownerId,
        type: 'OPEN',
        ...mandateWindow(),
        activate: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses to activate a mandate that has already lapsed', async () => {
    const listing = await makeListing();
    const mandate = await createMandate({
      tenantId: fixture.a.tenantId,
      actorId: fixture.a.userId,
      listingId: listing.id,
      ownerId,
      type: 'OPEN',
      startsAt: new Date(Date.now() - 60 * DAY),
      expiresAt: new Date(Date.now() - DAY),
    });

    await expect(
      decideMandate({
        tenantId: fixture.a.tenantId,
        actorId: fixture.a.userId,
        listingId: listing.id,
        mandateId: mandate.id,
        to: 'ACTIVE',
      }),
    ).rejects.toMatchObject({ status: 422, errors: [expect.objectContaining({ code: 'expired' })] });
  });

  it('takes the listing off the market when the mandate is terminated', async () => {
    const listing = await makeListing({ status: 'ACTIVE' });
    const mandate = await createMandate({
      tenantId: fixture.a.tenantId,
      actorId: fixture.a.userId,
      listingId: listing.id,
      ownerId,
      type: 'EXCLUSIVE',
      ...mandateWindow(),
      activate: true,
    });

    await decideMandate({
      tenantId: fixture.a.tenantId,
      actorId: fixture.a.userId,
      listingId: listing.id,
      mandateId: mandate.id,
      to: 'TERMINATED',
      note: 'Owner sold privately',
    });

    const after = await prisma.listing.findFirstOrThrow({
      where: { id: listing.id, tenantId: fixture.a.tenantId },
      select: { status: true, mandateType: true, mandateExpires: true },
    });
    // Without a live agreement there is no permission to advertise, so this is
    // not a warning banner.
    expect(after.status).toBe('WITHDRAWN');
    expect(after.mandateType).toBeNull();
    expect(after.mandateExpires).toBeNull();
  });

  it('expires a lapsed mandate and its listing when somebody next reads the book', async () => {
    const listing = await makeListing({ status: 'ACTIVE' });
    const mandate = await createMandate({
      tenantId: fixture.a.tenantId,
      actorId: fixture.a.userId,
      listingId: listing.id,
      ownerId,
      type: 'NON_EXCLUSIVE',
      ...mandateWindow(),
      activate: true,
    });
    // Backdated past its end, the way a mandate lapses in real life: nobody
    // does anything, a date passes.
    await prisma.mandate.update({
      where: { id: mandate.id, tenantId: fixture.a.tenantId },
      data: { expiresAt: new Date(Date.now() - DAY) },
    });

    const expired = await expireLapsedMandates(fixture.a.tenantId);
    expect(expired).toBeGreaterThanOrEqual(1);

    const after = await prisma.listing.findFirstOrThrow({
      where: { id: listing.id, tenantId: fixture.a.tenantId },
      select: { status: true, mandateExpires: true },
    });
    expect(after.status).toBe('EXPIRED');
    expect(after.mandateExpires).toBeNull();
  });
});

// ── Demand check ─────────────────────────────────────────────────────────────
describe('the demand check', () => {
  it('agrees with itself read from either end', async () => {
    const listing = await makeListing({ status: 'ACTIVE', price: new Prisma.Decimal(1_500_000) });
    await createMandate({
      tenantId: fixture.a.tenantId,
      actorId: fixture.a.userId,
      listingId: listing.id,
      ownerId,
      type: 'OPEN',
      ...mandateWindow(),
      activate: true,
    });

    const requirement = await makeRequirement({
      budgetMin: new Prisma.Decimal(1_000_000),
      budgetMax: new Prisma.Decimal(2_000_000),
      micromarketIds: [micromarketId],
      propertyTypes: ['APARTMENT'],
      bedroomsMin: 2,
    });

    // Requirement → listings, and listing → requirements. Two predicates
    // written separately; the pair has to appear in both or one of them is wrong.
    const forward = await matchesForRequirement(fixture.a.tenantId, requirement.id);
    const backward = await requirementsWanting(fixture.a.tenantId, listing.id);

    expect(forward?.matches.map((m) => m.id)).toContain(listing.id);
    expect(backward?.requirements.map((r) => r.id)).toContain(requirement.id);
  });

  it('treats an unstated criterion as "any", not as "none"', async () => {
    const listing = await makeListing({ status: 'ACTIVE', price: new Prisma.Decimal(950_000) });
    await createMandate({
      tenantId: fixture.a.tenantId,
      actorId: fixture.a.userId,
      listingId: listing.id,
      ownerId,
      type: 'OPEN',
      ...mandateWindow(),
      activate: true,
    });

    // A client who has said nothing but "I want to buy" should see everything.
    // The trap is a builder that emits `propertyType IN ()` and returns nothing.
    const open = await makeRequirement();
    const result = await matchesForRequirement(fixture.a.tenantId, open.id);
    expect(result?.matches.map((m) => m.id)).toContain(listing.id);
  });

  it('never offers stock the agency has lost the right to show', async () => {
    const listing = await makeListing({ status: 'ACTIVE', price: new Prisma.Decimal(1_100_000) });
    const mandate = await createMandate({
      tenantId: fixture.a.tenantId,
      actorId: fixture.a.userId,
      listingId: listing.id,
      ownerId,
      type: 'OPEN',
      ...mandateWindow(),
      activate: true,
    });
    const requirement = await makeRequirement({ budgetMax: new Prisma.Decimal(2_000_000) });

    expect((await matchesForRequirement(fixture.a.tenantId, requirement.id))?.matches.map((m) => m.id)).toContain(
      listing.id,
    );

    await decideMandate({
      tenantId: fixture.a.tenantId,
      actorId: fixture.a.userId,
      listingId: listing.id,
      mandateId: mandate.id,
      to: 'TERMINATED',
    });

    expect((await matchesForRequirement(fixture.a.tenantId, requirement.id))?.matches.map((m) => m.id)).not.toContain(
      listing.id,
    );
  });

  it('applies the budget strictly and the rest leniently', async () => {
    const cheap = await makeListing({ status: 'ACTIVE', price: new Prisma.Decimal(500_000), bedrooms: null });
    for (const l of [cheap]) {
      await createMandate({
        tenantId: fixture.a.tenantId,
        actorId: fixture.a.userId,
        listingId: l.id,
        ownerId,
        type: 'OPEN',
        ...mandateWindow(),
        activate: true,
      });
    }

    // Bedrooms unrecorded stays in: "unknown" is not "wrong", and excluding it
    // hides stock over a field nobody filled in.
    const lenient = await makeRequirement({ bedroomsMin: 3, budgetMax: new Prisma.Decimal(600_000) });
    expect((await matchesForRequirement(fixture.a.tenantId, lenient.id))?.matches.map((m) => m.id)).toContain(cheap.id);

    // Budget is not lenient. Showing a client something at twice their ceiling
    // is how an agent loses them.
    const strict = await makeRequirement({ budgetMax: new Prisma.Decimal(100_000) });
    expect((await matchesForRequirement(fixture.a.tenantId, strict.id))?.matches.map((m) => m.id)).not.toContain(
      cheap.id,
    );
  });

  it('does not match a rental against a buyer', () => {
    const where = listingsMatching(fixture.a.tenantId, {
      id: 'x',
      purpose: 'BUY',
      propertyTypes: [],
      micromarketIds: [],
      bedroomsMin: null,
      bedroomsMax: null,
      areaMinSqft: null,
      budgetMin: null,
      budgetMax: null,
      possessionBy: null,
      furnishing: null,
    });
    expect(where.listingType).toBe('SALE');
  });
});

// ── Book filters and owner PII ───────────────────────────────────────────────
describe('the listing book', () => {
  it('never reaches another workspace stock', async () => {
    const theirOwner = await prisma.owner.create({
      data: { tenantId: fixture.b.tenantId, fullName: 'Other Landlord' },
      select: { id: true },
    });
    const theirs = await prisma.listing.create({
      data: {
        tenantId: fixture.b.tenantId,
        reference: 'LS-OTHER',
        title: 'Elsewhere',
        listingType: 'SALE',
        propertyOwnerId: theirOwner.id,
        price: new Prisma.Decimal(1),
      },
    });

    const ids = (
      await prisma.listing.findMany({ where: listingWhere(fixture.a.tenantId, filters()), select: { id: true } })
    ).map((l) => l.id);
    expect(ids).not.toContain(theirs.id);
  });

  it('marketable means a live mandate and on the market, both', async () => {
    const where = listingWhere(fixture.a.tenantId, filters({ marketableOnly: true }));
    expect(where.status).toEqual({ in: ['ACTIVE', 'UNDER_OFFER'] });
    expect(where.mandateExpires).toHaveProperty('gt');
  });

  it('masks an owner contact details from a role without the sensitive permission', () => {
    const owner = {
      fullName: 'Yusuf Rahman',
      phone: '+971501234567',
      email: 'yusuf@example.com',
      whatsappNumber: null,
    };
    const withoutPermission = { actor: { permissions: new Map() } } as unknown as Ctx;
    const withPermission = {
      actor: { permissions: new Map([['listings:VIEW_SENSITIVE_FIELDS', 'ORGANIZATION']]) },
    } as unknown as Ctx;

    const masked = maskOwner(withoutPermission, owner)!;
    // Masked rather than omitted: a missing field reads as "no number on file"
    // and sends somebody hunting for one that already exists.
    expect(masked.phone).not.toBe(owner.phone);
    expect(masked.phone).toContain('•');
    expect(masked.phone).toContain('67');
    expect(masked.email).toContain('@example.com');
    expect(masked.email).not.toContain('yusuf');
    expect(masked.fullName).toBe('Yusuf Rahman');

    expect(maskOwner(withPermission, owner)!.phone).toBe(owner.phone);
  });
});
