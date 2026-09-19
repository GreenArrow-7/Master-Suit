import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { productivity } from '@/services/leadership/rollups';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * The per-seller productivity row: assigned → contacted → outcomes → deals →
 * untouched. Counts only; each one is attributable to rows the manager can open.
 */
let fixture: Fixture;
const RANGE = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T23:59:59Z') };
const inRange = new Date('2026-09-10T10:00:00Z');

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const T = fixture.a.tenantId;
  const me = fixture.a.userId;
  const [l1, l2, l3] = fixture.a.leadIds;

  // Three leads handed over this month; one gets a call, one an activity, one nothing.
  await prisma.lead.updateMany({
    where: { tenantId: T, id: { in: [l1, l2, l3] } },
    data: { ownerId: me, assignedAt: inRange, lastActivityAt: null },
  });
  await prisma.call.create({
    data: { tenantId: T, leadId: l1, callerId: me, status: 'COMPLETED', outcome: 'INTERESTED', createdAt: inRange },
  });
  await prisma.call.create({
    data: { tenantId: T, leadId: l1, callerId: me, status: 'COMPLETED', outcome: 'NOT_INTERESTED', createdAt: inRange },
  });
  await prisma.lead.update({ where: { tenantId: T, id: l1 }, data: { lastActivityAt: inRange } });
  const type = await prisma.activityType.upsert({
    where: { tenantId_key: { tenantId: T, key: 'note' } },
    update: {},
    create: { tenantId: T, key: 'note', name: 'Note' },
  });
  await prisma.activity.create({
    data: { tenantId: T, typeId: type.id, leadId: l2, ownerId: me, occurredAt: inRange },
  });
  await prisma.lead.update({ where: { tenantId: T, id: l2 }, data: { lastActivityAt: inRange } });
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('productivity rollup', () => {
  it('counts what a seller did with the leads they were given', async () => {
    const rows = await productivity(fixture.a.tenantId, [fixture.a.userId], RANGE);
    const me = rows.find((r) => r.userId === fixture.a.userId);
    expect(me).toMatchObject({
      assigned: 3,
      contacted: 2,
      callsCompleted: 2,
      interested: 1,
      notInterested: 1,
      followUpsCompleted: 0,
      meetingsScheduled: 0,
      dealsWon: 0,
    });
    // Untouched: every lead of theirs with no activity ever, regardless of the range.
    expect(me!.pending).toBeGreaterThanOrEqual(1);
  });

  it('stays inside the tenant', async () => {
    const rows = await productivity(fixture.b.tenantId, [], RANGE);
    expect(rows.find((r) => r.userId === fixture.a.userId)).toBeUndefined();
  });
});
