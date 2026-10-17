import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

import { prisma } from '@/lib/db';
import { moveCompany, type LeadEagleCompany } from '@/services/platform/leadEagleMove';
import CollectionsPage from '@/app/(workspace)/[workspaceSlug]/sales/collections/page';
import LeadDetailPage from '@/app/(workspace)/[workspaceSlug]/sales/leads/[id]/page';
import ColdDataPage from '@/app/(workspace)/[workspaceSlug]/sales/cold-data/page';
import { grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { pageText } from '../helpers/render';

/**
 * Moving a standalone Lead Eagle company into a workspace (Lead Eagle plan,
 * phase 5): what the reader hands over, written into the real database. The
 * reader itself is proven by the dry run against a copy of the standalone
 * database; this pins the writing — mapping, ownership, the dry run that keeps
 * nothing, and the refusal to move a company twice — and that the screens a
 * person then opens (Collections, a lead's page, Cold data) show what moved.
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
      nationality: 'Emirati',
      primaryIsWhatsapp: true,
      notes: 'Prefers mornings',
      score: 40,
      purpose: 'INVEST',
      propertyTypes: ['APARTMENT'],
      bedroomsMin: 2,
      bedroomsMax: 3,
      budgetMin: '1500000.00',
      budgetMax: '2500000.00',
      preferredLocations: ['Dubai Marina', 'JLT'],
      handoverBy: '2027-01-31T00:00:00Z',
      projectIds: ['p-1'],
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
      secondaryOwnerId: 'u-agent',
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
      projectIds: [],
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
      ownerId: 'u-ghost',
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
      type: 'VILLA',
      bedrooms: 4,
      bathrooms: 5,
      price: '3500000.00',
      sizeSqft: 3200,
      status: 'SOLD',
      heldById: null,
      heldUntil: null,
    },
  ],
  paymentPlans: [
    {
      projectId: 'p-1',
      name: '20/80 post-handover',
      milestones: [
        { label: 'On booking', percent: 20 },
        { label: 'Post-handover', percent: 80 },
      ],
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
  // The fixture admin holds leads and tasks, not the money screens.
  const { roleId } = await prisma.user.findFirstOrThrow({
    where: { tenantId, id: fixture.a.userId },
    select: { roleId: true },
  });
  await grantPermissions(tenantId, roleId, [
    ['collections', 'VIEW'],
    ['bookings', 'VIEW'],
  ]);
  cookieJar.value = fixture.a.cookie;
});

afterAll(async () => {
  // The record of each move outlives the workspace (tenantId set null); this one need not.
  await prisma.platformAuditEvent.deleteMany({ where: { tenantId } });
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

    // Real Estate is for what Lead Eagle's own menu lacks: Collections and
    // Commissions. Projects and listings have Lead Eagle screens of their own.
    expect(report.needsRealEstate).toBe(true);
    expect(report.problems).toContainEqual(expect.stringContaining('bookings or commissions'));
    const noMoney = await moveCompany(tenantId, { ...snapshot(), bookings: [], commissions: [] }, { commit: false });
    expect(noMoney.needsRealEstate).toBe(false);
    expect(noMoney.problems.some((p) => p.includes('--enable-real-estate'))).toBe(false);
  });

  it('reports every person a row loses and every row that stays behind', async () => {
    const snap = snapshot();
    const note = { ...snap.activities[0]!, summary: 'A note' };
    const report = await moveCompany(
      tenantId,
      {
        ...snap,
        // Owned by someone deleted in Lead Eagle, so not among its users.
        leads: [
          ...snap.leads,
          {
            ...snap.leads[1]!,
            id: 'l-3',
            reference: 'LE-0003',
            primaryPhone: '0501110004',
            ownerId: 'u-removed',
            // Interested in Sidra Villas, and in a project deleted in Lead Eagle, which does not move.
            projectIds: ['p-1', 'p-deleted'],
          },
        ],
        activities: [
          ...snap.activities,
          { ...note, userId: 'u-ghost' },
          { ...note, leadId: 'l-2', userId: 'u-removed' },
          // On a merged duplicate (the reader leaves merged leads behind), on deleted cold data, on nothing.
          { ...note, leadId: 'l-merged' },
          { ...note, leadId: null, dataRecordId: 'd-deleted', type: 'CALL' },
          { ...note, leadId: null },
          // On deleted cold data but also on a lead that moves: it moves onto the lead.
          { ...note, dataRecordId: 'd-deleted' },
        ],
        enquiries: [...snap.enquiries, { ...snap.enquiries[0]!, leadId: 'l-merged' }],
        followUps: [...snap.followUps, { ...snap.followUps[0]!, leadId: 'l-merged' }],
        // On a deleted project, and on a booking that stays behind (its listing has no price).
        units: [...snap.units, { ...snap.units[0]!, id: 'un-2', projectId: 'p-deleted' }],
        paymentPlans: [...snap.paymentPlans, { ...snap.paymentPlans[0]!, projectId: 'p-deleted' }],
        commissions: [...snap.commissions, { ...snap.commissions[0]!, bookingId: 'b-5' }],
      },
      { commit: false },
    );
    expect(report.problems).toEqual(
      expect.arrayContaining([
        'ghost@nowhere.test owns 2 records but has no account here; they move unowned.',
        '1 records are owned by people no longer in Lead Eagle; they move unowned.',
        '2 activities were logged by someone without an account here; they move without who logged them.',
        '1 stage changes were made by someone without an account here; they move without who made them.',
        '4 activities and enquiries are on merged duplicates, deleted records or no record; they stay behind.',
        '1 follow-ups are on merged duplicates or deleted leads; they stay behind.',
        '1 units are on projects that did not move; they stay behind.',
        '1 interest links are on projects that did not move; they stay behind.',
        '1 payment plans are on projects that did not move; they stay behind.',
        'A commission of AED 70000.00 is on booking BK-ME-b-5, which did not move; it stays behind.',
      ]),
    );
    expect(report.counts['activities and enquiries']).toEqual({ source: 13, moved: 9 });
    expect(report.counts['follow-ups']).toEqual({ source: 3, moved: 2 });
    expect(report.counts.units).toEqual({ source: 2, moved: 1 });
    expect(report.counts['interest links']).toEqual({ source: 3, moved: 2 });
    expect(report.counts['payment plans']).toEqual({ source: 2, moved: 1 });
    expect(await moved()).toHaveLength(0);
  });

  it('moves the book, matching people by email and reporting what needs a person', async () => {
    const report = await moveCompany(tenantId, snapshot(), { commit: true, enableRealEstate: true });
    expect(report.committed).toBe(true);
    expect(report.problems).toEqual(
      expect.arrayContaining([
        'ghost@nowhere.test owns 2 records but has no account here; they move unowned.',
        `1 follow-ups have no owner with an account; they are given to ${adminEmail}.`,
        'Listing LS-ME-2 has no price, which a listing here needs; it is not moved.',
        expect.stringContaining('Booking BK-ME-2 has no owner'),
        expect.stringContaining('owed to Outside referrer'),
        'Booking BK-ME-b-3 was confirmed but names no unit; it moves as a draft.',
        'Booking BK-ME-b-5 is on nothing that moved (its listing stayed behind); it is not moved.',
        '1 stage changes were made by someone without an account here; they move without who made them.',
      ]),
    );
    // Nothing else in this book is left behind or loses its person.
    expect(report.problems.filter((p) => /stays? behind\.$|no longer in Lead Eagle|logged by/.test(p))).toEqual([]);

    const [aisha, omar] = await moved();
    expect(aisha).toMatchObject({
      fullName: 'Aisha Karim',
      email: 'aisha@example.test',
      phoneNormalized: '+971501110001',
      ownerId: fixture.a.userId,
      source: 'MARKETPLACE',
      sourceDetail: 'Portal / Bayut · Marina launch',
      campaignName: 'Marina launch',
      nationality: 'Emirati',
      phoneIsWhatsapp: true,
      // The interest is a link now (M4-06), not a line in the notes.
      notes: 'Prefers mornings',
    });
    expect(aisha!.phones.map((p) => p.normalized)).toEqual(['+971521110002']);
    // The catalogue entry its source names (the board names the portal; the lead list filters on it).
    const entry = async (key: string) =>
      (await prisma.leadSource.findFirstOrThrow({ where: { tenantId, key }, select: { id: true } })).id;
    expect(aisha!.sourceId).toBe(await entry('bayut'));
    expect(omar!.sourceId).toBe(await entry('walk_in'));
    // First contacted at its inbound call, not at the earlier note; no contact moved for Omar.
    expect(aisha!.firstContactedAt?.toISOString()).toBe('2026-08-04T09:00:00.000Z');
    expect(omar!.firstContactedAt).toBeNull();
    // The secondary owner moves like the owner; a number with no flag stays off WhatsApp.
    expect(omar).toMatchObject({
      ownerId: null,
      secondaryOwnerId: fixture.a.userId,
      stageReason: 'Budget',
      nationality: null,
      phoneIsWhatsapp: false,
    });
    expect(omar!.stage).toMatchObject({
      key: 'not_interested',
      category: 'TERMINAL_NEGATIVE',
      requiresReason: true,
      reasons: ['Budget', 'Location'],
    });

    const requirement = await prisma.clientRequirement.findFirstOrThrow({ where: { tenantId, leadId: aisha!.id } });
    // The areas and the handover date are the requirement's own fields (M4-05, M4-08), not notes.
    expect(requirement).toMatchObject({
      purpose: 'BUY',
      bedroomsMin: 2,
      locations: ['Dubai Marina', 'JLT'],
      notes: null,
    });
    // Stored as the composer stores a chosen day: its end in the workspace's time zone (Dubai here).
    expect(requirement.possessionBy?.toISOString()).toBe('2027-01-31T19:59:59.999Z');
    const history = await prisma.leadStageHistory.findFirstOrThrow({ where: { tenantId, leadId: omar!.id } });
    expect(history).toMatchObject({ toStageId: omar!.stageId, reason: 'Budget' });
    // A note, an inbound call and the enquiry — once, though Lead Eagle wrote it twice.
    expect(await prisma.activity.count({ where: { tenantId, leadId: aisha!.id } })).toBe(3);
    const followUp = await prisma.followUpTask.findFirstOrThrow({ where: { tenantId, leadId: omar!.id } });
    expect(followUp).toMatchObject({ ownerId: fixture.a.userId, status: 'COMPLETED', kind: 'SITE_VISIT' });
    // A call reminder stays a call: the board counts it among the callbacks.
    expect(await prisma.followUpTask.findFirstOrThrow({ where: { tenantId, leadId: aisha!.id } })).toMatchObject({
      kind: 'CALL',
    });

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
    // Its catalogue counters follow the units that moved, and its price band stays its own.
    expect(project).toMatchObject({ totalUnits: 1, availableUnits: 0, soldUnits: 1, unitTypes: ['4BR'] });
    expect(project.minPrice?.toString()).toBe('3000000');
    // Aisha's interest in it is a link the project page lists (M4-06).
    expect(await prisma.leadProject.findMany({ where: { tenantId, projectId: project.id } })).toEqual([
      expect.objectContaining({ leadId: aisha!.id }),
    ]);
    expect(report.counts['interest links']).toEqual({ source: 1, moved: 1 });
    expect(await prisma.unitInventory.count({ where: { tenantId, projectId: project.id, status: 'SOLD' } })).toBe(1);
    // The unit keeps its type and bedrooms, on a plan of its project (M11-09).
    const unit = await prisma.unitInventory.findFirstOrThrow({
      where: { tenantId, projectId: project.id, unitNumber: 'V-12' },
      include: { unitPlan: true },
    });
    expect(unit.unitPlan).toMatchObject({ name: '4 bed Villa', unitType: '4BR', bedrooms: 4, bathrooms: 5 });
    // Its payment plan moves with it (M11-02).
    expect(await prisma.paymentPlan.findMany({ where: { tenantId, projectId: project.id } })).toEqual([
      expect.objectContaining({
        name: '20/80 post-handover',
        milestones: [
          { label: 'On booking', percent: 20 },
          { label: 'Post-handover', percent: 80 },
        ],
      }),
    ]);
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

  // The screens, rendered as the workspace's admin, after the commit above.
  it('lists moved drafts and cancellations on Collections', async () => {
    const text = await pageText(CollectionsPage());
    const notConfirmed = await prisma.booking.findMany({
      where: { tenantId, status: { not: 'CONFIRMED' } },
      select: { reference: true },
    });
    expect(notConfirmed).toHaveLength(3);
    for (const b of notConfirmed) expect(text).toContain(b.reference);
    expect(text).toContain('Draft');
    expect(text).toContain('Cancelled');
  });

  it("shows a moved lead's source and stage history on its page", async () => {
    const [aisha, omar] = await moved();
    const a = await pageText(LeadDetailPage({ params: Promise.resolve({ id: aisha!.id }) }));
    // Its catalogue entry ("Portal / Bayut" is Bayut), as an intake lead's reads, and its campaign.
    expect(a.split('\n')).toEqual(expect.arrayContaining(['Bayut', 'Marina launch']));
    // Omar has no activities: the instant is the moved status change's, and
    // reaches the page only through its stage history, with its stored time.
    const o = await pageText(LeadDetailPage({ params: Promise.resolve({ id: omar!.id }) }));
    expect(o).toContain('2026-08-05T09:00:00.000Z');
    expect(o).toContain('Not interested');
  });

  it('shows the migrated calls on the cold-data list', async () => {
    // The default list steps converted records aside; the filter brings them back.
    const text = await pageText(ColdDataPage({ searchParams: Promise.resolve({ status: 'CONVERTED' }) }));
    expect(text).toContain('Expo card\nRang from the expo list');
  });

  it('refuses to move the same company twice', async () => {
    await expect(moveCompany(tenantId, snapshot(), { commit: true })).rejects.toThrow('was already moved');
    expect(await moved()).toHaveLength(2);
  });

  it('moves a company with no leads once, and refuses it the second time', async () => {
    const snap = snapshot();
    const coldOnly: LeadEagleCompany = {
      ...snap,
      company: { id: 'le-company-2', slug: 'cold-only', name: 'Cold Only' },
      leads: [],
      activities: [],
      enquiries: [],
      followUps: [],
      dataRecords: [{ ...snap.dataRecords[1]!, fullName: 'Cold Only Record', phone: '0501110010' }],
      captureLinks: [],
      projects: [],
      units: [],
      paymentPlans: [],
      listings: [],
      bookings: [],
      commissions: [],
    };
    const first = await moveCompany(tenantId, coldOnly, { commit: true });
    expect(first.counts['cold data']).toEqual({ source: 1, moved: 1 });
    // Flat, so the workspace's own Audit log prints it as text.
    const row = await prisma.platformAuditEvent.findFirstOrThrow({ where: { tenantId, objectId: 'le-company-2' } });
    expect(row.metadata).toEqual({ slug: 'cold-only', leads: 0 });
    await expect(moveCompany(tenantId, coldOnly, { commit: true })).rejects.toThrow(
      /was already moved into this workspace \(audit record of \d{4}-\d{2}-\d{2}\)/,
    );
    expect(await prisma.dataRecord.count({ where: { tenantId, fullName: 'Cold Only Record' } })).toBe(1);
  });
});
