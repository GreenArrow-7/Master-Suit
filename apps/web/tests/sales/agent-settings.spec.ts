import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { ctxForUser } from '@/lib/auth/session';
import { resolveOwnerIds } from '@/lib/security/visibility';
import { assignLead } from '@/services/distribution/assignLead';
import { POST as adminAction } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/[action]/route';
import { POST as selfAction } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/self/[action]/route';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';
import { post } from '../helpers/request';

/**
 * A person's lead work, set where an administrator can reach it (audit M7-04,
 * M7-06, M7-07) and the reporting line it hangs from (M1-12): the manager
 * chain reaches every level below, the daily quota and the "available" switch
 * have writers, and assignment passes over whoever they stop.
 */
const suffix = randomBytes(4).toString('hex');
const slug = `agents-${suffix}`;
let tenantId = '';
let stageId = '';
let adminCookie = '';
let viewerCookie = '';
let adminId = '';
const people: Record<string, string> = {};

const settings = (body: Record<string, unknown>, cookie = adminCookie) =>
  post(adminAction, `/api/v1/workspaces/${slug}/identity/account-lead-settings`, body, cookie, {
    workspaceSlug: slug,
    action: 'account-lead-settings',
  });

beforeAll(async () => {
  tenantId = (
    await prisma.tenant.create({
      data: { slug, legalName: 'Agents LLC', displayName: 'Agents', status: 'ACTIVE' },
    })
  ).id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'LEAD_EAGLE', state: 'ACTIVE' } });
  stageId = (
    await prisma.leadStage.create({
      data: { tenantId, key: `new-${suffix}`, name: 'New', category: 'OPEN', isDefault: true, position: 0 },
    })
  ).id;
  const adminRole = await prisma.role.create({
    data: { tenantId, key: `admin-${suffix}`, name: 'Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, adminRole.id, [
    ['users', 'VIEW'],
    ['users', 'MANAGE_USERS'],
  ]);
  const agentRole = await prisma.role.create({
    data: { tenantId, key: `agent-${suffix}`, name: 'Agent', rank: 50, defaultScope: 'TEAM' },
  });
  await grantPermissions(tenantId, agentRole.id, [['leads', 'VIEW']], 'TEAM');
  const admin = await createWorkspaceUser({
    tenantId,
    roleId: adminRole.id,
    email: `a@${slug}.test`,
    fullName: 'Admin',
  });
  adminId = admin.id;
  adminCookie = await createSessionToken(tenantId, admin.id);
  for (const name of ['director', 'manager', 'rep', 'agent', 'other']) {
    people[name] = (
      await createWorkspaceUser({ tenantId, roleId: agentRole.id, email: `${name}@${slug}.test`, fullName: name })
    ).id;
  }
  viewerCookie = await createSessionToken(tenantId, people.rep!);
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

beforeEach(async () => {
  await prisma.distributionRule.deleteMany({ where: { tenantId } });
  await prisma.user.updateMany({
    where: { tenantId },
    data: { dailyLeadQuota: null, isAvailable: true, managerId: null, languages: [] },
  });
});

/** One round-robin rule over `pool`, with only the checks a case names, and `last` as the previous turn. */
async function rule(pool: string[], last: string, checks: { respectQuotas?: boolean; respectLeave?: boolean }) {
  await prisma.distributionRule.create({
    data: {
      tenantId,
      name: 'Agents in turn',
      method: 'ROUND_ROBIN',
      isActive: true,
      candidatePool: { userIds: pool },
      lastAssignedUserId: last,
      respectWorkingHours: false,
      respectCapacity: false,
      respectQuotas: checks.respectQuotas ?? false,
      respectLeave: checks.respectLeave ?? false,
    },
  });
}

async function newLeadAssigned() {
  const lead = await prisma.lead.create({
    data: { tenantId, reference: `AG-${randomBytes(3).toString('hex')}`, fullName: 'Walk-in', stageId },
  });
  const outcome = await assignLead(tenantId, lead.id);
  const history = await prisma.leadAssignmentHistory.findFirst({
    where: { tenantId, leadId: lead.id },
    select: { toOwnerId: true, note: true },
  });
  return { outcome, owner: history?.toOwnerId ?? null, note: history?.note ?? '' };
}

it('a manager sees the records of their reports’ reports, not only their own reports (M1-12)', async () => {
  // Through the API: the manager reports to the director, the rep to the manager.
  expect((await settings({ userId: people.manager, managerId: people.director, available: 'yes' })).status).toBe(200);
  expect((await settings({ userId: people.rep, managerId: people.manager, available: 'yes' })).status).toBe(200);

  const seen = await resolveOwnerIds(await ctxForUser(people.director!, tenantId, `m112-${suffix}`), 'TEAM');
  expect(seen).toEqual(expect.arrayContaining([people.manager, people.rep]));
  expect(seen).not.toContain(people.other);

  // A line that would close into a loop is refused.
  const loop = await settings({ userId: people.director, managerId: people.rep, available: 'yes' });
  expect(loop.status).toBe(409);
});

it('an administrator sets the quota, languages and availability; a member without users:MANAGE_USERS cannot', async () => {
  const saved = await settings({
    userId: people.agent,
    dailyLeadQuota: '5',
    languages: 'Arabic, english, arabic',
    available: 'no',
  });
  expect(saved.status).toBe(200);
  const row = await prisma.user.findFirstOrThrow({
    where: { tenantId, id: people.agent },
    select: { dailyLeadQuota: true, languages: true, isAvailable: true },
  });
  expect(row).toEqual({ dailyLeadQuota: 5, languages: ['Arabic', 'english'], isAvailable: false });

  // Left blank, the quota means no limit again.
  expect((await settings({ userId: people.agent, available: 'yes' })).status).toBe(200);
  expect(
    await prisma.user.findFirstOrThrow({
      where: { tenantId, id: people.agent },
      select: { dailyLeadQuota: true, isAvailable: true },
    }),
  ).toEqual({ dailyLeadQuota: null, isAvailable: true });

  expect((await settings({ userId: people.agent, dailyLeadQuota: '50' }, viewerCookie)).status).toBe(403);
  // The rank rule of every account action: never your own account from here.
  expect((await settings({ userId: adminId, managerId: people.agent })).status).toBe(403);
});

it('an agent at the daily quota an administrator set is passed over, and the sentence says so (M7-06)', async () => {
  expect((await settings({ userId: people.agent, dailyLeadQuota: '5', available: 'yes' })).status).toBe(200);
  // Five leads handed to the agent earlier today.
  const earlier = await prisma.lead.create({
    data: { tenantId, reference: `Q-${suffix}`, fullName: 'Earlier today', stageId },
  });
  await prisma.leadAssignmentHistory.createMany({
    data: Array.from({ length: 5 }, () => ({
      tenantId,
      leadId: earlier.id,
      toOwnerId: people.agent!,
      reason: 'MANUAL',
    })),
  });
  await rule([people.agent!, people.other!], people.other!, { respectQuotas: true });

  const { owner, note } = await newLeadAssigned();
  expect(owner).toBe(people.other);
  expect(note).toContain('daily quota 5/5');
});

it('an agent who switches themselves off for new leads is passed over as marked unavailable (M7-07)', async () => {
  const agentCookie = await createSessionToken(tenantId, people.agent!);
  const off = await post(
    selfAction,
    `/api/v1/workspaces/${slug}/identity/self/lead-availability`,
    { isAvailable: false },
    agentCookie,
    { workspaceSlug: slug, action: 'lead-availability' },
  );
  expect(off.status).toBe(200);
  await rule([people.agent!, people.other!], people.other!, { respectLeave: true });

  const { owner, note } = await newLeadAssigned();
  expect(owner).toBe(people.other);
  expect(note).toContain('marked unavailable');
});
