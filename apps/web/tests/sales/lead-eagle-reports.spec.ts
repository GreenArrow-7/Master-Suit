import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { runReport } from '@/services/leadership/reports';
import { buildActor, buildCtx } from '../helpers/ctx';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * Lead Eagle plan, gap 7: follow-up adherence, and each source followed through
 * site visits to bookings — the two reports Lead Eagle had and this did not.
 */
const suffix = randomBytes(4).toString('hex');
const day = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * day);

let fixture: Fixture;
let tenantId: string;
const range = () => ({ from: at(-10), to: at(10) });
const ctx = () => buildCtx(buildActor({ id: fixture.a.userId, tenantId, grants: [['reports', 'VIEW']] }));

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  const owner = fixture.a.userId;
  const leadId = fixture.a.leadIds[0]!;
  const followUp = (dueAt: Date, extra: Record<string, unknown> = {}) =>
    prisma.followUpTask.create({ data: { tenantId, leadId, ownerId: owner, title: 'Call back', dueAt, ...extra } });
  await followUp(at(-5), { status: 'COMPLETED', completedAt: at(-6) });
  await followUp(at(-4), { status: 'COMPLETED', completedAt: at(-2) });
  await followUp(at(-3));
  await followUp(at(5));
  await followUp(at(-1), { status: 'CANCELLED' });

  const lead = (source: string, sourceDetail: string | null) =>
    prisma.lead.create({
      data: {
        tenantId,
        reference: `RP-${suffix}-${randomBytes(3).toString('hex')}`,
        fullName: 'Report lead',
        stageId: fixture.a.stageId,
        source: source as never,
        sourceDetail,
      },
    });
  const bayutOne = await lead('MARKETPLACE', 'bayut:REF-1');
  const bayutTwo = await lead('MARKETPLACE', 'bayut:REF-2');
  await lead('PUBLIC_FORM', 'capture:stand-a1b2c3');
  // A property visit goes somewhere (SiteVisit_destination_check).
  const project = await prisma.project.create({ data: { tenantId, name: 'Report project', code: `RP-${suffix}` } });
  await prisma.siteVisit.create({
    data: {
      tenantId,
      ownerId: owner,
      leadId: bayutOne.id,
      projectId: project.id,
      scheduledAt: at(-2),
      status: 'COMPLETED',
    },
  });
  // A confirmed booking names its unit (Booking_confirmed_requires_unit).
  const unit = await prisma.unitInventory.create({ data: { tenantId, projectId: project.id, unitNumber: 'U-1' } });
  const booking = (leadIdValue: string, status: 'CONFIRMED' | 'CANCELLED') =>
    prisma.booking.create({
      data: {
        tenantId,
        reference: `BK-${suffix}-${randomBytes(3).toString('hex')}`,
        leadId: leadIdValue,
        ownerId: owner,
        projectId: project.id,
        unitInventoryId: status === 'CONFIRMED' ? unit.id : null,
        status,
        saleValue: '1000000',
        bookingDate: at(-1),
      },
    });
  await booking(bayutOne.id, 'CONFIRMED');
  await booking(bayutTwo.id, 'CANCELLED');
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('Lead Eagle reports', () => {
  it('follow-up adherence: on time, late, still overdue, not yet due, cancelled left out', async () => {
    const report = await runReport(ctx(), 'follow-up-adherence', range());
    expect(report.rows).toEqual([
      { agent: 'manath Administrator', due: 4, done: 2, onTime: 1, late: 1, overdue: 1, rate: '25%' },
    ]);
  });

  it('source to booking: portals by name, visits and bookings, cancelled ones left out', async () => {
    const report = await runReport(ctx(), 'source-to-booking', range());
    const bySource = Object.fromEntries(report.rows.map((r) => [r.source, r]));
    expect(report.rows[0]!.source).toBe('Bayut');
    expect(bySource.Bayut).toMatchObject({ leads: 2, visited: 1, bookings: 1, value: 'AED 1,000,000', rate: '50%' });
    expect(bySource['QR capture']).toMatchObject({ leads: 1, visited: 0, bookings: 0, rate: '0%' });
    // The fixture's own leads carry the default source.
    expect(bySource.Manual).toMatchObject({ leads: 5, bookings: 0 });
  });
});
