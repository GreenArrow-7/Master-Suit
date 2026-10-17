import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { checkLeadFirstContact } from '@/services/sla/checkLeadFirstContact';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

// Audit M7-08, M7-09: an untouched lead at its SLA tells the owner's manager,
// and goes to someone else when the active rule asks for re-assignment.
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

it('a breach notifies the manager once and hands the lead to the next agent', async () => {
  const lead = await prisma.lead.create({
    data: { tenantId, reference: `SLA-${suffix}`, fullName: 'Untouched lead', stageId, ownerId: agentId },
  });

  await checkLeadFirstContact(tenantId, lead.id);
  await checkLeadFirstContact(tenantId, lead.id);

  const notices = await prisma.notification.findMany({
    where: { tenantId, kind: 'lead.sla_breached', recordId: lead.id },
    select: { userId: true },
  });
  expect(notices).toEqual([{ userId: managerId }]);
  const after = await prisma.lead.findFirstOrThrow({
    where: { tenantId, id: lead.id },
    select: { ownerId: true, slaState: true },
  });
  expect(after).toEqual({ ownerId: otherId, slaState: 'BREACHED' });
});
