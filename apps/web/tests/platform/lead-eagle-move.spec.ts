import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { moveCompany, type LeadEagleCompany } from '@/services/platform/leadEagleMove';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * Moving a standalone Lead Eagle company into a workspace (Lead Eagle plan,
 * phase 5): what the reader hands over, written into the real database. The
 * reader itself is proven by the dry run against a copy of the standalone
 * database; this pins the writing — mapping, ownership, the dry run that keeps
 * nothing, and the refusal to move a company twice.
 */
let fixture: Fixture;
let tenantId: string;
let adminEmail: string;

/** A plain reserved booking on Omar's lead, varied per case below. */
const booking = (id: string, listingId: string | null) => ({
  id,
  reference: `BK-ME-${id}`,
  leadId: 'l-2',
  unitId: null,
  projectId: null,
  listingId,
  status: 'RESERVED' as const,
  bookingDate: '2026-09-06T09:00:00Z',
  dealValue: '100000.00',
  received: '0.00',
  cancelReason: null,
  notes: null,
  createdById: null,
  updatedAt: '2026-09-07T09:00:00Z',
});

const snapshot = (): LeadEagleCompany => ({
  company: { id: 'le-company-1', slug: 'meridian', name: 'Meridian Properties' },
  users: [
    { id: 'u-agent', email: adminEmail.toUpperCase(), fullName: 'Matched Agent' },
    { id: 'u-ghost', email: 'ghost@nowhere.test', fullName: 'Left the company' },
  ],
  statuses: [
    {
      id: 's-new',
      key: 'new-lead',
      name: 'New',
      category: 'OPEN',
      position: 1,
      requiresReason: false,
      slaMinutes: 30,
      subStatuses: [],
    },
    {
      id: 's-lost',
      key: 'not-interested',
      name: 'Not interested',
      category: 'LOST',
      position: 9,
      requiresReason: true,
      slaMinutes: null,
      subStatuses: ['Budget', 'Location'],
    },
  ],
  leads: [
    {
      id: 'l-1',
      reference: 'LE-0001',
      fullName: 'Aisha Karim',
      email: 'Aisha@Example.test',
      primaryPhone: '050 111 0001',
      phones: [{ raw: '+971 52 111 0002', label: 'Work', isWhatsapp: false }],
      statusId: 's-new',
      subStatus: null,
      lostReason: null,
      ownerId: 'u-agent',
      source: 'Portal / Bayut',
      campaign: 'Marina launch',
      tags: ['vip'],
      notes: 'Prefers mornings',
      score: 40,
      purpose: 'INVEST',
      propertyTypes: ['APARTMENT'],
      bedroomsMin: 2,
      bedroomsMax: 3,
      budgetMin: '1500000.00',
      budgetMax: '2500000.00',
      preferredLocations: ['Dubai Marina', 'JLT'],
      projects: ['Sidra Villas'],
      createdAt: '2026-08-01T09:00:00Z',
      lastActivityAt: '2026-09-01T09:00:00Z',
      nextFollowUpAt: null,
    },
    {
      id: 'l-2',
      reference: 'LE-0002',
      fullName: 'Omar Saleh',
      email: null,
      primaryPhone: '0501110003',
      phones: [],
      statusId: 's-lost',
      subStatus: 'Budget',
      lostReason: null,
      ownerId: 'u-ghost',
      source: 'Walk-in',
      campaign: null,
      tags: [],
      notes: null,
      score: 0,
      purpose: null,
      propertyTypes: [],
      bedroomsMin: null,
      bedroomsMax: null,
      budgetMin: null,
      budgetMax: null,
      preferredLocations: [],
      projects: [],
      createdAt: '2026-08-02T09:00:00Z',
      lastActivityAt: null,
      nextFollowUpAt: null,
    },
  ],
  activities: [
    {
      leadId: 'l-1',
      dataRecordId: null,
      userId: 'u-agent',
      type: 'NOTE',
      summary: 'Called back',
      body: null,
      callDirection: null,
      callOutcome: null,
      callDurationSecs: null,
      fromStatusId: null,
      toStatusId: null,
      occurredAt: '2026-08-03T09:00:00Z',
    },
    {
      leadId: 'l-1',
      dataRecordId: null,
      userId: 'u-agent',
      type: 'CALL',
      summary: 'Discussed budget',
      body: null,
      callDirection: 'INBOUND',
      callOutcome: 'CONNECTED',
      callDurationSecs: 180,
      fromStatusId: null,
      toStatusId: null,
      occurredAt: '2026-08-04T09:00:00Z',
    },
    {
      leadId: 'l-2',
      dataRecordId: null,
      userId: 'u-ghost',
      type: 'STATUS_CHANGE',
      summary: 'Moved to Not interested',
      body: 'Budget',
      callDirection: null,
      callOutcome: null,
      callDurationSecs: null,
      fromStatusId: 's-new',
      toStatusId: 's-lost',
      occurredAt: '2026-08-05T09:00:00Z',
    },
    {
      // Lead Eagle's own copy of the enquiry below; it must not appear twice.
      leadId: 'l-1',
      dataRecordId: null,
      userId: null,
      type: 'ENQUIRY',
      summary: 'Enquiry received',
      body: null,
      callDirection: null,
      callOutcome: null,
      callDurationSecs: null,
      fromStatusId: null,
      toStatusId: null,
      occurredAt: '2026-08-01T09:00:00Z',
    },
    {
      leadId: null,
      dataRecordId: 'd-1',
      userId: 'u-agent',
      type: 'CALL',
      summary: 'Rang from the expo list',
      body: null,
      callDirection: 'OUTBOUND',
      callOutcome: 'CONNECTED',
      callDurationSecs: 60,
      fromStatusId: null,
      toStatusId: null,
      occurredAt: '2026-07-30T09:00:00Z',
    },
  ],
  enquiries: [
    { leadId: 'l-1', source: 'Bayut', message: 'Is the 2-bed available?', receivedAt: '2026-08-01T09:00:00Z' },
  ],
  followUps: [
    {
      leadId: 'l-1',
      ownerId: 'u-agent',
      type: 'CALL',
      dueAt: '2026-10-20T09:00:00Z',
      note: 'Send the brochure',
      doneAt: null,
      outcome: null,
      cancelledAt: null,
    },
    {
      leadId: 'l-2',
      ownerId: 'u-ghost',
      type: 'SITE_VISIT',
      dueAt: '2026-08-10T09:00:00Z',
      note: null,
      doneAt: '2026-08-10T10:00:00Z',
      outcome: 'Visited',
      cancelledAt: null,
    },
  ],
  dataRecords: [
    {
      id: 'd-1',
      fullName: 'Aisha Karim',
      phone: '0501110001',
      email: null,
      company: null,
      jobTitle: null,
      city: 'Dubai',
      notes: 'Expo card',
      status: 'CONVERTED',
      batch: 'Expo Feb',
      ownerId: 'u-agent',
      convertedLeadId: 'l-1',
      convertedAt: '2026-08-01T09:00:00Z',
      createdAt: '2026-07-29T09:00:00Z',
    },
    {
      id: 'd-2',
      fullName: 'Wrong Number',
      phone: '0501110009',
      email: null,
      company: null,
      jobTitle: null,
      city: null,
      notes: null,
      status: 'JUNK',
      batch: null,
      ownerId: null,
      convertedLeadId: null,
      convertedAt: null,
      createdAt: '2026-07-29T09:00:00Z',
    },
  ],
  captureLinks: [
    {
      key: 'expo-stand',
      label: 'Expo stand',
      headline: null,
      assignToId: 'u-agent',
      campaign: 'Sidra',
      isActive: true,
      scans: 12,
      submissions: 3,
    },
  ],
  projects: [
    {
      id: 'p-1',
      name: 'Sidra Villas',
      developer: 'Emaar',
      community: 'Dubai Hills',
      city: 'Dubai',
      status: 'READY',
      handoverAt: null,
      priceFrom: '3000000.00',
      priceTo: '6000000.00',
      permitNumber: 'RERA-1',
      description: null,
      amenities: ['Pool'],
    },
  ],
  units: [
    {
      id: 'un-1',
      projectId: 'p-1',
      unitNumber: 'V-12',
      floor: null,
      view: 'Park',
      price: '3500000.00',
      sizeSqft: 3200,
      status: 'SOLD',
      heldById: null,
      heldUntil: null,
    },
  ],
  listings: [
    {
      id: 'li-1',
      reference: 'LS-ME-1',
      title: 'Marina 2-bed',
      purpose: 'RENT',
      propertyType: 'APARTMENT',
      status: 'ACTIVE',
      bedrooms: 2,
      bathrooms: 2,
      sizeSqft: 1200,
      furnishing: 'FURNISHED',
      price: '120000.00',
      rentFrequency: 'YEARLY',
      address: 'Dubai Marina, Dubai',
      latitude: null,
      longitude: null,
      amenities: [],
      description: null,
      permitNumber: null,
      availableFrom: null,
      ownerName: 'Landlord One',
      ownerPhone: '0559990001',
      ownerEmail: null,
      agentId: 'u-agent',
    },
    {
      id: 'li-2',
      reference: 'LS-ME-2',
      title: 'Unpriced draft',
      purpose: 'SALE',
      propertyType: 'VILLA',
      status: 'DRAFT',
      bedrooms: null,
      bathrooms: null,
      sizeSqft: null,
      furnishing: null,
      price: null,
      rentFrequency: null,
      address: null,
      latitude: null,
      longitude: null,
      amenities: [],
      description: null,
      permitNumber: null,
      availableFrom: null,
      ownerName: null,
      ownerPhone: null,
      ownerEmail: null,
      agentId: null,
    },
  ],
  bookings: [
    {
      id: 'b-1',
      reference: 'BK-ME-1',
      leadId: 'l-1',
      unitId: 'un-1',
      projectId: 'p-1',
      listingId: null,
      status: 'COMPLETED',
      bookingDate: '2026-09-01T09:00:00Z',
      dealValue: '3500000.00',
      received: '350000.00',
      cancelReason: null,
      notes: null,
      createdById: 'u-agent',
      updatedAt: '2026-09-02T09:00:00Z',
    },
    {
      id: 'b-2',
      reference: 'BK-ME-2',
      leadId: 'l-2',
      unitId: null,
      projectId: null,
      listingId: 'li-1',
      status: 'RESERVED',
      bookingDate: '2026-09-05T09:00:00Z',
      dealValue: '120000.00',
      received: '0.00',
      cancelReason: null,
      notes: null,
      createdById: null,
      updatedAt: '2026-09-05T09:00:00Z',
    },
    // Confirmed on a listing, with no unit: a confirmed booking here names its unit.
    { ...booking('b-3', 'li-1'), status: 'CONFIRMED' },
    // Cancelled without a reason: a cancellation here carries one.
    { ...booking('b-4', null), projectId: 'p-1', status: 'CANCELLED' },
    // On the unpriced listing, which stays behind: nothing left to be a booking of.
    { ...booking('b-5', 'li-2'), status: 'RESERVED' },
  ],
  commissions: [
    {
      bookingId: 'b-1',
      userId: 'u-agent',
      externalName: null,
      percent: '2.000',
      amount: '70000.00',
      status: 'RECEIVED',
      paidAt: '2026-09-15T09:00:00Z',
    },
    {
      bookingId: 'b-1',
      userId: null,
      externalName: 'Outside referrer',
      percent: null,
      amount: '5000.00',
      status: 'PENDING',
      paidAt: null,
    },
  ],
  notMoved: { Proposal: 2 },
});

const moved = () =>
  prisma.lead.findMany({
    where: { tenantId, customData: { path: ['leadEagle', 'company'], equals: 'le-company-1' } },
    include: { phones: true, stage: true },
    orderBy: { createdAt: 'asc' },
  });

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  adminEmail = `admin@${fixture.a.slug}.test`;
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('moving a Lead Eagle company', () => {
  it('dry-runs every write and keeps none of it', async () => {
    const stagesBefore = await prisma.leadStage.count({ where: { tenantId } });
    const report = await moveCompany(tenantId, snapshot(), { commit: false });
    expect(report.committed).toBe(false);
    expect(report.counts.leads).toEqual({ source: 2, moved: 2 });
    expect(report.counts.bookings).toEqual({ source: 5, moved: 4 });
    expect(await moved()).toHaveLength(0);
    expect(await prisma.leadStage.count({ where: { tenantId } })).toBe(stagesBefore);
  });

  it('moves the book, matching people by email and reporting what needs a person', async () => {
    const report = await moveCompany(tenantId, snapshot(), { commit: true, enableRealEstate: true });
    expect(report.committed).toBe(true);
    expect(report.problems).toEqual(
      expect.arrayContaining([
        'ghost@nowhere.test owns 1 leads but has no account here; they move unowned.',
        'Listing LS-ME-2 has no price, which a listing here needs; it is not moved.',
        expect.stringContaining('Booking BK-ME-2 has no owner'),
        expect.stringContaining('owed to Outside referrer'),
        'Booking BK-ME-b-3 was confirmed but names no unit; it moves as a draft.',
        'Booking BK-ME-b-5 is on nothing that moved (its listing stayed behind); it is not moved.',
      ]),
    );

    const [aisha, omar] = await moved();
    expect(aisha).toMatchObject({
      fullName: 'Aisha Karim',
      email: 'aisha@example.test',
      phoneNormalized: '+971501110001',
      ownerId: fixture.a.userId,
      source: 'MARKETPLACE',
      sourceDetail: 'Portal / Bayut · Marina launch',
      notes: 'Prefers mornings\nInterested in projects: Sidra Villas',
    });
    expect(aisha!.phones.map((p) => p.normalized)).toEqual(['+971521110002']);
    expect(omar).toMatchObject({ ownerId: null, stageReason: 'Budget' });
    expect(omar!.stage).toMatchObject({
      key: 'not_interested',
      category: 'TERMINAL_NEGATIVE',
      requiresReason: true,
      reasons: ['Budget', 'Location'],
    });

    const requirement = await prisma.clientRequirement.findFirstOrThrow({ where: { tenantId, leadId: aisha!.id } });
    expect(requirement).toMatchObject({ purpose: 'BUY', bedroomsMin: 2, notes: 'Areas: Dubai Marina, JLT' });
    const history = await prisma.leadStageHistory.findFirstOrThrow({ where: { tenantId, leadId: omar!.id } });
    expect(history).toMatchObject({ toStageId: omar!.stageId, reason: 'Budget' });
    // A note, an inbound call and the enquiry — once, though Lead Eagle wrote it twice.
    expect(await prisma.activity.count({ where: { tenantId, leadId: aisha!.id } })).toBe(3);
    const followUp = await prisma.followUpTask.findFirstOrThrow({ where: { tenantId, leadId: omar!.id } });
    expect(followUp).toMatchObject({ ownerId: fixture.a.userId, status: 'COMPLETED' });

    const records = await prisma.dataRecord.findMany({ where: { tenantId }, orderBy: { fullName: 'asc' } });
    expect(records.map((r) => [r.fullName, r.status, r.batch])).toEqual([
      ['Aisha Karim', 'CONVERTED', 'Expo Feb'],
      ['Wrong Number', 'INVALID', 'Lead Eagle'],
    ]);
    expect(records[0]).toMatchObject({ convertedLeadId: aisha!.id, notes: 'Expo card\nRang from the expo list' });
    expect(await prisma.captureLink.findFirst({ where: { tenantId, key: 'expo-stand' } })).toMatchObject({
      ownerId: fixture.a.userId,
      openCount: 12,
      submitCount: 3,
    });

    const project = await prisma.project.findFirstOrThrow({ where: { tenantId, name: 'Sidra Villas' } });
    expect(project).toMatchObject({ code: 'LE-SIDRAVILLAS', status: 'READY', possessionStatus: 'READY_TO_MOVE' });
    expect(await prisma.unitInventory.count({ where: { tenantId, projectId: project.id, status: 'SOLD' } })).toBe(1);
    const listing = await prisma.listing.findFirstOrThrow({ where: { tenantId, reference: 'LS-ME-1' } });
    expect(listing).toMatchObject({ listingType: 'RENT', ownerId: fixture.a.userId });
    expect(listing.propertyOwnerId).not.toBeNull();

    const bookings = await prisma.booking.findMany({ where: { tenantId }, orderBy: { status: 'asc' } });
    expect(bookings.map((b) => [b.status, b.ownerId, b.cancelReason])).toEqual([
      ['DRAFT', fixture.a.userId, null],
      ['DRAFT', fixture.a.userId, null],
      ['CONFIRMED', fixture.a.userId, null],
      ['CANCELLED', fixture.a.userId, 'Cancelled in Lead Eagle'],
    ]);
    const commissions = await prisma.commission.findMany({ where: { tenantId } });
    expect(commissions.map((c) => [c.status, c.amount.toString()])).toEqual([['COLLECTED', '70000']]);
    const realEstate = await prisma.moduleEntitlement.findFirst({ where: { tenantId, module: 'REAL_ESTATE' } });
    expect(realEstate?.state).toBe('ACTIVE');
  });

  it('refuses to move the same company twice', async () => {
    await expect(moveCompany(tenantId, snapshot(), { commit: true })).rejects.toThrow('was already moved');
    expect(await moved()).toHaveLength(2);
  });
});
