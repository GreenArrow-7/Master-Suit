import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { prisma, withPlatformTx } from '@/lib/db';
import { assignLead, ruleMatches } from '@/services/distribution/assignLead';
import { provisionLeadWork } from '@/services/platform/provisioning';
import { GET as listRules, POST as createRule } from '@/app/api/v1/distribution-rules/route';
import { PATCH as editRule, DELETE as deleteRule } from '@/app/api/v1/distribution-rules/[id]/route';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { del, get, patch, post } from '../helpers/request';

// Audit M7-01: a Lead Eagle workspace can turn automatic assignment on, and starts with it on.
const suffix = randomBytes(4).toString('hex');
let fixture: Fixture;

beforeAll(async () => {
  fixture = await seedTwoTenants();
});
afterAll(async () => {
  await fixture.cleanup();
});

it('Lead Eagle arriving seeds one "everyone" rule, and a new lead is assigned through it', async () => {
  const { tenantId, stageId } = fixture.a;
  await prisma.distributionRule.deleteMany({ where: { tenantId } });
  await withPlatformTx((tx) => provisionLeadWork(tx, tenantId, ['LEAD_EAGLE'], []));
  await withPlatformTx((tx) => provisionLeadWork(tx, tenantId, ['LEAD_EAGLE'], [])); // idempotent

  const rules = await prisma.distributionRule.findMany({ where: { tenantId, deletedAt: null } });
  expect(rules.map((r) => [r.name, r.isActive, r.candidatePool])).toEqual([
    ['Everyone, in turn', true, { everyone: true }],
  ]);

  const lead = await prisma.lead.create({
    data: { tenantId, reference: `RR-${suffix}`, fullName: 'Round robin', stageId },
  });
  const outcome = await assignLead(tenantId, lead.id);
  expect(outcome.outcome).toBe('assigned');
});

it('the rules API lists for viewers and creates only for allocation:APPROVE', async () => {
  const { tenantId } = fixture.a;
  const leaderRole = await prisma.role.create({
    data: { tenantId, key: `leader-${suffix}`, name: 'Leader', rank: 20, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, leaderRole.id, [
    ['allocation', 'VIEW'],
    ['allocation', 'APPROVE'],
    ['leads', 'VIEW'],
    ['leads', 'ASSIGN'],
  ]);
  const leader = await createWorkspaceUser({
    tenantId,
    roleId: leaderRole.id,
    email: `l@rules-${suffix}.test`,
    fullName: 'Leader',
  });
  const cookie = await createSessionToken(tenantId, leader.id);

  expect((await get(listRules, '/api/v1/distribution-rules', cookie)).status).toBe(200);
  const created = await post(
    createRule,
    '/api/v1/distribution-rules',
    { name: 'Ready agents', userIds: [leader.id] },
    cookie,
  );
  expect(created.status).toBe(200);
  const id = created.body.id as string;
  const off = await patch(editRule, `/api/v1/distribution-rules/${id}`, { isActive: false }, cookie, { id });
  expect([off.status, off.body.isActive]).toEqual([200, false]);
  expect((await del(deleteRule, `/api/v1/distribution-rules/${id}`, cookie, { id })).status).toBe(200);

  const viewerRole = await prisma.role.create({
    data: { tenantId, key: `viewer-${suffix}`, name: 'Viewer', rank: 90, defaultScope: 'OWN' },
  });
  await grantPermissions(tenantId, viewerRole.id, [['allocation', 'VIEW']]);
  const viewer = await createWorkspaceUser({
    tenantId,
    roleId: viewerRole.id,
    email: `v@rules-${suffix}.test`,
    fullName: 'Viewer',
  });
  const viewerCookie = await createSessionToken(tenantId, viewer.id);
  expect((await get(listRules, '/api/v1/distribution-rules', viewerCookie)).status).toBe(200);
  expect((await post(createRule, '/api/v1/distribution-rules', { name: 'Mine' }, viewerCookie)).status).toBe(403);
});

it('a rule with conditions takes only matching leads; others fall through to the next rule (M7-03)', async () => {
  const { tenantId, stageId, userId } = fixture.a;
  const source = await prisma.leadSource.create({
    data: { tenantId, name: `Bayut ${suffix}`, key: `bayut-${suffix}` },
  });
  const user = await prisma.user.findFirstOrThrow({ where: { tenantId, id: userId }, select: { roleId: true } });
  const specialist = await createWorkspaceUser({
    tenantId,
    roleId: user.roleId,
    email: `s@rules-${suffix}.test`,
    fullName: 'Bayut specialist',
  });
  await prisma.distributionRule.deleteMany({ where: { tenantId } });
  const loose = { respectWorkingHours: false, respectQuotas: false, respectCapacity: false, respectLeave: false };
  await prisma.distributionRule.createMany({
    data: [
      {
        tenantId,
        name: 'Bayut',
        method: 'ROUND_ROBIN',
        isActive: true,
        position: 0,
        candidatePool: { userIds: [specialist.id] },
        conditions: { sourceIds: [source.id] },
        ...loose,
      },
      {
        tenantId,
        name: 'Rest',
        method: 'ROUND_ROBIN',
        isActive: true,
        position: 1,
        candidatePool: { userIds: [userId] },
        ...loose,
      },
    ],
  });

  const bayut = await prisma.lead.create({
    data: { tenantId, reference: `B-${suffix}`, fullName: 'From Bayut', stageId, sourceId: source.id },
  });
  const other = await prisma.lead.create({
    data: { tenantId, reference: `O-${suffix}`, fullName: 'From elsewhere', stageId },
  });
  await assignLead(tenantId, bayut.id);
  await assignLead(tenantId, other.id);

  const owners = await prisma.lead.findMany({
    where: { tenantId, id: { in: [bayut.id, other.id] } },
    select: { id: true, ownerId: true },
  });
  expect(Object.fromEntries(owners.map((lead) => [lead.id, lead.ownerId]))).toEqual({
    [bayut.id]: specialist.id,
    [other.id]: userId,
  });

  expect(ruleMatches({ cities: ['Dubai'] }, { sourceId: null, city: 'dubai', projectIds: [] })).toBe(true);
  expect(ruleMatches({ cities: ['Dubai'] }, { sourceId: null, city: null, projectIds: [] })).toBe(false);
  expect(ruleMatches({ projectIds: ['p1'] }, { sourceId: null, city: null, projectIds: ['p1', 'p2'] })).toBe(true);
});
