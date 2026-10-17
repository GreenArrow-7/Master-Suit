import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { prisma, withPlatformTx } from '@/lib/db';
import { assignLead } from '@/services/distribution/assignLead';
import { provisionLeadWork } from '@/services/platform/provisioning';
import { GET as listRules, POST as createRule } from '@/app/api/v1/distribution-rules/route';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { get, post } from '../helpers/request';

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
