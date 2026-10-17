import { randomBytes } from 'node:crypto';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { checkLeadFirstContact, sweepFirstContact } from '@/services/sla/checkLeadFirstContact';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

// Audit M7-08, M7-09, M17-08: an untouched lead at its SLA tells the owner's
// manager, and goes to someone else when the active rule asks for re-assignment.
const suffix = randomBytes(4).toString('hex');
let fixture: Fixture;
let tenantId = '';
let stageId = '';
let managerId = '';
let agentId = '';
let otherId = '';

beforeAll(async () => {
  fixture = await seedTwoTenants();
  ({ tenantId, stageId } = fixture.a);
  managerId = fixture.a.userId;
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId }, select: { id: true } });
  const make = async (name: string) =>
    (
      await prisma.user.create({
        data: {
          tenantId,
          email: `${name}-${suffix}@sla.test`,
          fullName: name,
          status: 'ACTIVE',
          roleId: role.id,
          managerId,
        },
      })
    ).id;
  agentId = await make('Agent');
  otherId = await make('Other');
  await prisma.distributionRule.deleteMany({ where: { tenantId } });
  await prisma.distributionRule.create({
    data: {
      tenantId,
      name: 'Two agents',
      method: 'ROUND_ROBIN',
      isActive: true,
      candidatePool: { userIds: [agentId, otherId] },
      lastAssignedUserId: agentId,
      reassignAfterMins: 30,
      respectWorkingHours: false,
      respectQuotas: false,
      respectCapacity: false,
      respectLeave: false,
    },
  });
});

afterAll(async () => {
  await fixture.cleanup();
});

/** The rule's people, the rotation starting after the agent. */
const pool = (userIds: string[]) =>
  prisma.distributionRule.updateMany({
    where: { tenantId },
    data: { candidatePool: { userIds }, lastAssignedUserId: agentId },
  });
const untouched = (name: string, data: { ownerId?: string | null; assignedAt?: Date } = { ownerId: agentId }) =>
  prisma.lead.create({
    data: { tenantId, reference: `SLA-${randomBytes(3).toString('hex')}`, fullName: name, stageId, ...data },
  });
const notices = (leadId: string, kind: string) =>
  prisma.notification.findMany({
    where: { tenantId, kind, recordId: leadId },
    select: { userId: true, title: true, body: true },
  });

it('a breach notifies the manager once and hands the lead to the next agent', async () => {
  await pool([agentId, otherId]);
  const lead = await untouched('Untouched lead');

  await checkLeadFirstContact(tenantId, lead.id);
  await checkLeadFirstContact(tenantId, lead.id);

  expect((await notices(lead.id, 'lead.sla_breached')).map((n) => n.userId)).toEqual([managerId]);
  const after = await prisma.lead.findFirstOrThrow({
    where: { tenantId, id: lead.id },
    select: { ownerId: true, slaState: true },
  });
  expect(after).toEqual({ ownerId: otherId, slaState: 'BREACHED' });
  // Audit M17-07: the agent it was taken from hears why; the next agent hears it is theirs.
  const moved = await notices(lead.id, 'lead.assigned');
  expect(moved).toEqual(
    expect.arrayContaining([
      {
        userId: agentId,
        title: 'Lead taken back: Untouched lead',
        body: 'First contact was overdue, so it went to the next person in turn.',
      },
      expect.objectContaining({ userId: otherId, title: 'Lead assigned: Untouched lead' }),
    ]),
  );
  expect(moved).toHaveLength(2);
});

it('says nothing of a take-back when the rotation hands the lead straight back', async () => {
  await pool([agentId]);
  const lead = await untouched('Back again');

  await checkLeadFirstContact(tenantId, lead.id);

  const after = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: lead.id }, select: { ownerId: true } });
  expect(after.ownerId).toBe(agentId);
  expect((await notices(lead.id, 'lead.assigned')).map((n) => n.title)).toEqual(['Lead assigned: Back again']);
});

it('says the lead is waiting when nobody can take it', async () => {
  await pool([]);
  const lead = await untouched('Nobody free');

  await checkLeadFirstContact(tenantId, lead.id);

  expect(await notices(lead.id, 'lead.assigned')).toEqual([
    {
      userId: agentId,
      title: 'Lead taken back: Nobody free',
      body: 'First contact was overdue, so it is waiting to be handed out again.',
    },
  ]);
});

// Audit M17-08: a lead handed out after its one delayed check (from the queue, by
// Allocate, by bulk assign) is escalated once its new owner leaves it untouched
// for the stage's minutes, counted from when they got it.
it('escalates, once, a lead its owner got after the first check and has not contacted', async () => {
  await pool([agentId, otherId]);
  await prisma.leadStage.updateMany({ where: { tenantId, id: stageId }, data: { slaMinutes: 15 } });
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
  // Arrived out of hours: the check at its deadline found nobody to tell.
  const lead = await untouched('Handed out late', { ownerId: null });
  await checkLeadFirstContact(tenantId, lead.id);
  expect(await notices(lead.id, 'lead.sla_breached')).toEqual([]);
  // That check ran an hour ago; the agent was given it by hand ten minutes ago.
  // Another lead they did contact.
  await prisma.lead.updateMany({
    where: { tenantId, id: lead.id },
    data: { slaEscalatedAt: minutesAgo(60), ownerId: agentId, assignedAt: minutesAgo(10) },
  });
  const contacted = await untouched('Contacted', { ownerId: agentId, assignedAt: minutesAgo(40) });
  await prisma.lead.updateMany({ where: { tenantId, id: contacted.id }, data: { firstContactedAt: minutesAgo(35) } });

  expect(await sweepFirstContact(new Date(), tenantId)).toEqual({ escalated: 0 });

  await prisma.lead.updateMany({ where: { tenantId, id: lead.id }, data: { assignedAt: minutesAgo(20) } });
  expect(await sweepFirstContact(new Date(), tenantId)).toEqual({ escalated: 1 });
  expect(await sweepFirstContact(new Date(), tenantId)).toEqual({ escalated: 0 });

  expect(await notices(lead.id, 'lead.sla_breached')).toEqual([
    {
      userId: managerId,
      title: 'Handed out late has not been contacted',
      body: 'First contact by Agent is overdue.',
    },
  ]);
  const after = await prisma.lead.findFirstOrThrow({ where: { tenantId, id: lead.id }, select: { ownerId: true } });
  expect(after.ownerId).toBe(otherId);
  expect(await notices(contacted.id, 'lead.sla_breached')).toEqual([]);
});

it('runs the first-contact sweep from the maintenance queue every five minutes', async () => {
  const { MAINTENANCE_JOBS, armMaintenanceScheduler } = await import('@/workers/maintenance');
  expect(Object.keys(MAINTENANCE_JOBS)).toContain('first-contact');
  const armed = vi.spyOn(Queue.prototype, 'upsertJobScheduler').mockResolvedValue(undefined as never);
  try {
    await armMaintenanceScheduler();
    expect(armed).toHaveBeenCalledWith(
      'first-contact-five-minutely',
      { pattern: '*/5 * * * *' },
      { name: 'first-contact' },
    );
  } finally {
    armed.mockRestore();
  }
});
