/**
 * Removing a workspace account, and the four ways it must refuse.
 *
 * `users:DELETE` is a grant of its own rather than part of MANAGE_USERS: a
 * workspace can let somebody reset passwords and suspend accounts without
 * letting them remove one, and the first test here is what makes that real.
 *
 * The rest are the guards that stop an administrator locking the workspace out
 * of itself, or quietly destroying records — deletion is soft, and the row it
 * marks survives so that leads, activities and audit entries still name a
 * person instead of a dangling id.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  DELETE as identityDelete,
  GET as identityGet,
  POST as identityPost,
} from '@/app/api/v1/workspaces/[workspaceSlug]/identity/[action]/route';
import { POST as hrAction } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/actions/[action]/route';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser, type Grants, grantPermissions } from '../helpers/fixtures';
import { del, get, post } from '../helpers/request';

const suffix = randomBytes(4).toString('hex');
const slug = `userdel-${suffix}`;

let tenantId = '';
let orgAdminCookie = '';
let managerOnlyCookie = '';
let orgAdminId = '';

const at = { params: { workspaceSlug: slug, action: 'account-delete' } };
const path = (userId: string) =>
  `/api/v1/workspaces/${slug}/identity/account-delete?userId=${encodeURIComponent(userId)}`;

async function role(label: string, rank: number, grants: Grants) {
  const created = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(tenantId, created.id, grants);
  return created;
}

/** A disposable member to delete, at a rank below the administrator's. */
async function member(label: string, roleId: string, branchId?: string) {
  return createWorkspaceUser({
    tenantId,
    roleId,
    email: `${label}-${suffix}@userdel.test`,
    fullName: `${label} Person`,
    branchId,
  });
}

let adminRoleId = '';
let staffRoleId = '';
let teamAdminCookie = '';
let branchAdminCookie = '';
let branchId = '';
let viewerCookie = '';
let hrCookie = '';
let stageId = '';
let wonStageId = '';
let taskTypeId = '';

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'User Delete LLC', displayName: 'User Delete', status: 'ACTIVE' },
  });
  tenantId = tenant.id;

  // rank 10 matches ADMIN_ROLE_RANK, so these count as administrators for the
  // last-admin guard — the same shape the seed gives Organization Administrator.
  // leads:ASSIGN is what lets them hand a departing member's work on.
  const orgAdmin = await role('orgadmin', 10, [
    ['users', 'VIEW'],
    ['users', 'MANAGE_USERS'],
    ['users', 'DELETE'],
    ['leads', 'ASSIGN'],
  ]);
  // Administers accounts, but assigns leads only inside a team it has none of.
  const teamAdmin = await prisma.role.create({
    data: { tenantId, key: `teamadmin-${suffix}`, name: 'teamadmin', rank: 10, defaultScope: 'TEAM' },
  });
  await grantPermissions(tenantId, teamAdmin.id, [
    ['users', 'VIEW'],
    ['users', 'MANAGE_USERS'],
  ]);
  await grantPermissions(tenantId, teamAdmin.id, [['leads', 'ASSIGN']], 'TEAM');
  stageId = (
    await prisma.leadStage.create({
      data: { tenantId, key: `new-${suffix}`, name: 'New', position: 0, isDefault: true },
    })
  ).id;
  wonStageId = (
    await prisma.leadStage.create({
      data: { tenantId, key: `won-${suffix}`, name: 'Won', position: 9, category: 'CONVERSION' },
    })
  ).id;
  taskTypeId = (await prisma.taskType.create({ data: { tenantId, key: `call-${suffix}`, name: 'Call' } })).id;
  const managerOnly = await role('manageronly', 10, [
    ['users', 'VIEW'],
    ['users', 'MANAGE_USERS'],
  ]);
  const staff = await role('staff', 50, [['users', 'VIEW']]);
  adminRoleId = orgAdmin.id;
  staffRoleId = staff.id;

  const admin = await member('orgadmin', orgAdmin.id);
  orgAdminId = admin.id;
  const manager = await member('manageronly', managerOnly.id);

  // A second administrator, so removing one never trips the last-admin guard
  // except in the test that means to.
  await member('spareadmin', orgAdmin.id);

  // Removes accounts and assigns leads only inside its own branch.
  branchId = (await prisma.branch.create({ data: { tenantId, name: 'Marina', code: `MAR-${suffix}` } })).id;
  const branchAdmin = await role('branchadmin', 10, [
    ['users', 'VIEW'],
    ['users', 'DELETE'],
  ]);
  await grantPermissions(tenantId, branchAdmin.id, [['leads', 'ASSIGN']], 'BRANCH');
  branchAdminCookie = await createSessionToken(tenantId, (await member('branchadmin', branchAdmin.id, branchId)).id);
  // Reads the directory, and nothing more.
  const viewer = await role('viewer', 10, [['users', 'VIEW']]);
  viewerCookie = await createSessionToken(tenantId, (await member('viewer', viewer.id)).id);
  // HR closes an employment, which ends the workspace account too.
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });
  const hr = await role('hradmin', 10, [
    ['employee', 'EDIT'],
    ['leads', 'ASSIGN'],
  ]);
  hrCookie = await createSessionToken(tenantId, (await member('hradmin', hr.id)).id);

  orgAdminCookie = await createSessionToken(tenantId, admin.id);
  managerOnlyCookie = await createSessionToken(tenantId, manager.id);
  teamAdminCookie = await createSessionToken(tenantId, (await member('teamadmin', teamAdmin.id)).id);
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('USERDEL-001: removing a workspace account', () => {
  it('lets an Organization Administrator remove a member, and soft-deletes rather than destroys', async () => {
    const victim = await member('removable', staffRoleId);

    const res = await del(identityDelete, path(victim.id), orgAdminCookie, at.params);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.removed).toBe(true);

    // The row survives — records that reference it must still resolve to a name.
    const row = await prisma.user.findFirst({
      where: { tenantId, id: victim.id },
      select: { deletedAt: true, status: true, fullName: true },
      // The tenant guard filters soft-deleted rows out of ordinary reads.
      ...({ __includeDeleted: true } as Record<string, unknown>),
    });
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.status).toBe('DEACTIVATED');
    expect(row?.fullName).toBe('removable Person');

    const membership = await prisma.workspaceMembership.findFirst({
      where: { tenantId, salesUserId: victim.id },
      select: { status: true, removedAt: true },
    });
    expect(membership?.status).toBe('REMOVED');
    expect(membership?.removedAt).not.toBeNull();
  });

  it('records the removal in the audit log', async () => {
    const victim = await member('audited', staffRoleId);
    await del(identityDelete, path(victim.id), orgAdminCookie, at.params);

    const entry = await prisma.auditLog.findFirst({
      where: { tenantId, objectType: 'user', recordId: victim.id, event: 'RECORD_DELETED' },
      select: { actorUserId: true },
    });
    expect(entry).not.toBeNull();
    expect(entry?.actorUserId).toBe(orgAdminId);
  });

  it('refuses MANAGE_USERS without DELETE — the whole point of the separate grant', async () => {
    const victim = await member('survivor', staffRoleId);

    const res = await del(identityDelete, path(victim.id), managerOnlyCookie, at.params);
    expect(res.status).toBe(403);

    const still = await prisma.user.findFirst({ where: { tenantId, id: victim.id }, select: { deletedAt: true } });
    expect(still?.deletedAt).toBeNull();
  });

  it('refuses an account at or above the actor’s own level', async () => {
    const peer = await member('peeradmin', adminRoleId); // rank 10, same as the actor
    const res = await del(identityDelete, path(peer.id), orgAdminCookie, at.params);
    expect(res.status).toBe(403);
  });

  it('refuses self-removal', async () => {
    const res = await del(identityDelete, path(orgAdminId), orgAdminCookie, at.params);
    expect(res.status).toBe(403);
  });

  it('refuses the workspace’s primary administrator', async () => {
    const primary = await member('primary', staffRoleId);
    await prisma.workspaceMembership.updateMany({
      where: { tenantId, salesUserId: primary.id },
      data: { isPrimaryAdmin: true },
    });

    const res = await del(identityDelete, path(primary.id), orgAdminCookie, at.params);
    expect(res.status).toBe(409);

    const still = await prisma.user.findFirst({ where: { tenantId, id: primary.id }, select: { deletedAt: true } });
    expect(still?.deletedAt).toBeNull();
  });

  it('refuses a user from another workspace', async () => {
    const other = await prisma.tenant.create({
      data: { slug: `other-${suffix}`, legalName: 'Other LLC', displayName: 'Other', status: 'ACTIVE' },
    });
    const otherRole = await prisma.role.create({
      data: { tenantId: other.id, key: `staff-${suffix}`, name: 'Staff', rank: 50, defaultScope: 'ORGANIZATION' },
    });
    const stranger = await createWorkspaceUser({
      tenantId: other.id,
      roleId: otherRole.id,
      email: `stranger-${suffix}@userdel.test`,
      fullName: 'Stranger',
    });

    const res = await del(identityDelete, path(stranger.id), orgAdminCookie, at.params);
    expect(res.status).toBeGreaterThanOrEqual(400);

    const still = await prisma.user.findFirst({
      where: { tenantId: other.id, id: stranger.id },
      select: { deletedAt: true },
    });
    expect(still?.deletedAt).toBeNull();

    await prisma.tenant.delete({ where: { id: other.id } }).catch(() => {});
  });
});

/**
 * USERDEL-002: deactivating or removing an account hands its open work on.
 *
 * Both used to leave the account's open leads, follow-ups and tasks owned by a
 * SUSPENDED (or removed) user — invisible to colleagues working at OWN scope and
 * absent from the Allocation queue, because a lead with an owner is not waiting.
 * Now the server refuses while any is left unless the request names where it
 * goes: a member, or the allocation queue for the leads.
 */
describe('USERDEL-002: open work is handed over, never left with a suspended account', () => {
  const activeAt = { workspaceSlug: slug, action: 'account-active' };
  const deactivate = (body: Record<string, unknown>, as = orgAdminCookie) =>
    post(identityPost, `/api/v1/workspaces/${slug}/identity/account-active`, { active: false, ...body }, as, activeAt);

  /** An agent with 3 open leads, 2 open follow-ups and 1 open task — plus work that is not open and stays. */
  async function agentWithWork(label: string, opts: { followUps?: number; tasks?: number } = {}) {
    const agent = await member(label, staffRoleId);
    const leadIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const lead = await prisma.lead.create({
        data: {
          tenantId,
          reference: `${label}-${i}-${suffix}`,
          fullName: `${label} lead ${i}`,
          stageId,
          ownerId: agent.id,
        },
      });
      leadIds.push(lead.id);
    }
    // A won lead is history, not work: it keeps its owner.
    await prisma.lead.create({
      data: {
        tenantId,
        reference: `${label}-won-${suffix}`,
        fullName: `${label} won`,
        stageId: wonStageId,
        ownerId: agent.id,
      },
    });
    const due = new Date(Date.now() + 86_400_000);
    for (let i = 0; i < (opts.followUps ?? 2); i += 1) {
      await prisma.followUpTask.create({
        data: {
          tenantId,
          ownerId: agent.id,
          leadId: leadIds[i],
          title: `Call back ${i}`,
          dueAt: due,
          status: i ? 'RESCHEDULED' : 'OPEN',
        },
      });
    }
    await prisma.followUpTask.create({
      data: { tenantId, ownerId: agent.id, title: 'Done already', dueAt: due, status: 'COMPLETED' },
    });
    for (let i = 0; i < (opts.tasks ?? 1); i += 1) {
      await prisma.task.create({
        data: { tenantId, typeId: taskTypeId, ownerId: agent.id, title: `Send brochure ${i}`, dueAt: due },
      });
    }
    return { agent, leadIds };
  }

  /** What the account still owns that somebody should be working. */
  async function openOwnedBy(userId: string) {
    const open = { in: ['OPEN', 'IN_PROGRESS', 'RESCHEDULED'] as ('OPEN' | 'IN_PROGRESS' | 'RESCHEDULED')[] };
    const [leads, followUps, tasks] = await Promise.all([
      prisma.lead.count({ where: { tenantId, ownerId: userId, deletedAt: null, stage: { is: { category: 'OPEN' } } } }),
      prisma.followUpTask.count({ where: { tenantId, ownerId: userId, deletedAt: null, status: open } }),
      prisma.task.count({ where: { tenantId, ownerId: userId, deletedAt: null, status: open } }),
    ]);
    return { leads, followUps, tasks };
  }

  const statusOf = async (userId: string) =>
    (
      await prisma.user.findFirst({
        where: { tenantId, id: userId },
        select: { status: true },
        ...({ __includeDeleted: true } as Record<string, unknown>),
      })
    )?.status;

  it('refuses to deactivate an agent who still owns open work, and names it', async () => {
    const { agent } = await agentWithWork('refused');

    const res = await deactivate({ userId: agent.id });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.detail).toContain('3 open leads, 2 follow-ups and 1 task');
    // As data too, so an API caller need not parse the sentence.
    expect(res.body.openWork).toEqual({ leads: 3, followUps: 2, tasks: 1 });
    expect(await statusOf(agent.id)).toBe('ACTIVE');

    // The queue takes leads only; follow-ups and tasks still need a person.
    const queueOnly = await deactivate({ userId: agent.id, leadsToQueue: true });
    expect(queueOnly.status, JSON.stringify(queueOnly.body)).toBe(409);
    expect(await statusOf(agent.id)).toBe('ACTIVE');
    expect(await openOwnedBy(agent.id)).toEqual({ leads: 3, followUps: 2, tasks: 1 });
  });

  it('deactivating an agent with 3 open leads, 2 follow-ups and 1 task leaves 0 open records with the SUSPENDED account', async () => {
    const { agent, leadIds } = await agentWithWork('handed');
    const receiver = await member('receiver', staffRoleId);

    const res = await deactivate({ userId: agent.id, handOverTo: receiver.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await statusOf(agent.id)).toBe('SUSPENDED');

    expect(await openOwnedBy(agent.id)).toEqual({ leads: 0, followUps: 0, tasks: 0 });
    expect(await openOwnedBy(receiver.id)).toEqual({ leads: 3, followUps: 2, tasks: 1 });
    // Not open, so not handed over: the won lead and the completed follow-up keep their history.
    expect(await prisma.lead.count({ where: { tenantId, ownerId: agent.id } })).toBe(1);
    expect(await prisma.followUpTask.count({ where: { tenantId, ownerId: agent.id } })).toBe(1);

    const history = await prisma.leadAssignmentHistory.findMany({
      where: { tenantId, leadId: { in: leadIds } },
      select: { fromOwnerId: true, toOwnerId: true, reason: true },
    });
    expect(history).toHaveLength(3);
    for (const row of history) {
      expect(row).toEqual({ fromOwnerId: agent.id, toOwnerId: receiver.id, reason: 'OWNER_DEACTIVATED' });
    }
    const entry = await prisma.auditLog.findFirst({
      where: { tenantId, event: 'OWNER_CHANGED', objectType: 'user', recordId: agent.id },
      select: { actorUserId: true },
    });
    expect(entry?.actorUserId).toBe(orgAdminId);
  });

  it('sends the leads to the allocation queue, unassigned and waiting, and the rest to a member', async () => {
    const { agent, leadIds } = await agentWithWork('queued');
    const receiver = await member('queuereceiver', staffRoleId);

    const res = await deactivate({ userId: agent.id, handOverTo: receiver.id, leadsToQueue: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect(await openOwnedBy(agent.id)).toEqual({ leads: 0, followUps: 0, tasks: 0 });
    expect(await openOwnedBy(receiver.id)).toEqual({ leads: 0, followUps: 2, tasks: 1 });
    const leads = await prisma.lead.findMany({ where: { tenantId, id: { in: leadIds } }, select: { ownerId: true } });
    expect(leads.map((lead) => lead.ownerId)).toEqual([null, null, null]);
    // The way an unplaced intake lead waits: one open triage episode each.
    const waiting = await prisma.leadTriageEntry.findMany({
      where: { tenantId, leadId: { in: leadIds }, status: 'WAITING' },
      select: { reason: true },
    });
    expect(waiting.map((row) => row.reason)).toEqual(['OWNER_DEACTIVATED', 'OWNER_DEACTIVATED', 'OWNER_DEACTIVATED']);
  });

  it('needs no member when only leads are left and they go to the queue', async () => {
    const { agent } = await agentWithWork('leadsonly', { followUps: 0, tasks: 0 });
    const res = await deactivate({ userId: agent.id, leadsToQueue: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await openOwnedBy(agent.id)).toEqual({ leads: 0, followUps: 0, tasks: 0 });
  });

  it('removing an account refuses the same way, and hands over the same way', async () => {
    const { agent } = await agentWithWork('removedwork');
    const receiver = await member('removereceiver', staffRoleId);

    const refused = await del(identityDelete, path(agent.id), orgAdminCookie, at.params);
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(await statusOf(agent.id)).toBe('ACTIVE');

    const res = await del(identityDelete, `${path(agent.id)}&handOverTo=${receiver.id}`, orgAdminCookie, at.params);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await statusOf(agent.id)).toBe('DEACTIVATED');
    expect(await openOwnedBy(agent.id)).toEqual({ leads: 0, followUps: 0, tasks: 0 });
    expect(await openOwnedBy(receiver.id)).toEqual({ leads: 3, followUps: 2, tasks: 1 });
  });

  it('refuses a hand-over to an account that is not active, or to the departing one', async () => {
    const { agent } = await agentWithWork('badtarget');
    const parked = await member('parked', staffRoleId);
    await prisma.user.update({ where: { tenantId, id: parked.id }, data: { status: 'SUSPENDED' } });
    // Suspended the platform console's way: the membership, with the User left ACTIVE.
    const offline = await member('offline', staffRoleId);
    await prisma.workspaceMembership.update({ where: { id: offline.membershipId }, data: { status: 'SUSPENDED' } });

    for (const handOverTo of [parked.id, agent.id, offline.id]) {
      const res = await deactivate({ userId: agent.id, handOverTo });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
    }
    expect(await statusOf(agent.id)).toBe('ACTIVE');
    expect(await openOwnedBy(agent.id)).toEqual({ leads: 3, followUps: 2, tasks: 1 });
  });

  it('refuses when the caller’s ASSIGN scope does not reach the agent, and changes nothing', async () => {
    const { agent } = await agentWithWork('outofreach');
    const receiver = await member('reachreceiver', staffRoleId);

    const res = await deactivate({ userId: agent.id, handOverTo: receiver.id }, teamAdminCookie);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(await statusOf(agent.id)).toBe('ACTIVE');
    expect(await openOwnedBy(agent.id)).toEqual({ leads: 3, followUps: 2, tasks: 1 });
  });

  it('gives the dialog the counts and only active members to hand to', async () => {
    const { agent } = await agentWithWork('counted');
    const parked = await member('parkedmember', staffRoleId);
    await prisma.user.update({ where: { tenantId, id: parked.id }, data: { status: 'SUSPENDED' } });
    const offline = await member('offlinemember', staffRoleId);
    await prisma.workspaceMembership.update({ where: { id: offline.membershipId }, data: { status: 'SUSPENDED' } });

    const res = await get(
      identityGet,
      `/api/v1/workspaces/${slug}/identity/account-work?userId=${agent.id}`,
      orgAdminCookie,
      { workspaceSlug: slug, action: 'account-work' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ leads: 3, followUps: 2, tasks: 1, mayHandOver: true });
    const memberIds = (res.body.members as { id: string }[]).map((m) => m.id);
    expect(memberIds).toContain(orgAdminId);
    expect(memberIds).not.toContain(agent.id);
    expect(memberIds).not.toContain(parked.id);
    expect(memberIds).not.toContain(offline.id);
  });

  it('tells an administrator without leads:ASSIGN before submit, and shows no workload to users:VIEW alone', async () => {
    const { agent } = await agentWithWork('upfront');
    const work = (cookie: string) =>
      get(identityGet, `/api/v1/workspaces/${slug}/identity/account-work?userId=${agent.id}`, cookie, {
        workspaceSlug: slug,
        action: 'account-work',
      });

    // MANAGE_USERS without leads:ASSIGN, like the seeded hr_admin and it_admin.
    const manager = await work(managerOnlyCookie);
    expect(manager.status, JSON.stringify(manager.body)).toBe(200);
    expect(manager.body).toMatchObject({ leads: 3, followUps: 2, tasks: 1, mayHandOver: false });

    // Outranks the agent, but may neither deactivate nor remove.
    const viewer = await work(viewerCookie);
    expect(viewer.status, JSON.stringify(viewer.body)).toBe(403);
  });

  it('a BRANCH-scoped remover who reaches the agent hands the work over', async () => {
    const { agent } = await agentWithWork('branchremoved');
    await prisma.user.update({ where: { tenantId, id: agent.id }, data: { branchId } });
    const receiver = await member('branchreceiver', staffRoleId, branchId);

    const res = await del(identityDelete, `${path(agent.id)}&handOverTo=${receiver.id}`, branchAdminCookie, at.params);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await statusOf(agent.id)).toBe('DEACTIVATED');
    expect(await openOwnedBy(agent.id)).toEqual({ leads: 0, followUps: 0, tasks: 0 });
    expect(await openOwnedBy(receiver.id)).toEqual({ leads: 3, followUps: 2, tasks: 1 });
  });

  it('removing an account can send its leads to the allocation queue', async () => {
    const { agent, leadIds } = await agentWithWork('removequeued', { followUps: 0, tasks: 0 });

    const res = await del(identityDelete, `${path(agent.id)}&leadsToQueue=true`, orgAdminCookie, at.params);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await statusOf(agent.id)).toBe('DEACTIVATED');
    const leads = await prisma.lead.findMany({ where: { tenantId, id: { in: leadIds } }, select: { ownerId: true } });
    expect(leads.map((lead) => lead.ownerId)).toEqual([null, null, null]);
    const waiting = await prisma.leadTriageEntry.count({
      where: { tenantId, leadId: { in: leadIds }, status: 'WAITING' },
    });
    expect(waiting).toBe(3);
  });

  it('HR finalising an exit refuses the same way, and hands the work over the same way', async () => {
    const { agent } = await agentWithWork('exiting');
    const receiver = await member('exitreceiver', staffRoleId);
    const employee = await prisma.employeeProfile.create({
      data: {
        tenantId,
        membershipId: agent.membershipId,
        employeeNumber: `EXIT-${suffix}`,
        joinedOn: new Date('2020-01-01'),
        employmentStatus: 'NOTICE',
      },
    });
    const exit = (body: Record<string, unknown>) =>
      post(
        hrAction,
        `/api/v1/workspaces/${slug}/hr/actions/employee-exit`,
        { employeeId: employee.id, confirmSettlementPaid: true, ...body },
        hrCookie,
        { workspaceSlug: slug, action: 'employee-exit' },
      );
    const employment = async () =>
      (await prisma.employeeProfile.findFirstOrThrow({ where: { tenantId, id: employee.id } })).employmentStatus;

    const refused = await exit({});
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.openWork).toEqual({ leads: 3, followUps: 2, tasks: 1 });
    expect(await employment()).toBe('NOTICE');
    expect(await statusOf(agent.id)).toBe('ACTIVE');

    const res = await exit({ handOverTo: receiver.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await employment()).toBe('EXITED');
    expect(await statusOf(agent.id)).toBe('DEACTIVATED');
    expect(await openOwnedBy(agent.id)).toEqual({ leads: 0, followUps: 0, tasks: 0 });
    expect(await openOwnedBy(receiver.id)).toEqual({ leads: 3, followUps: 2, tasks: 1 });
  });

  it('still deactivates an account with nothing open without asking for a hand-over', async () => {
    const idle = await member('idle', staffRoleId);
    const res = await deactivate({ userId: idle.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await statusOf(idle.id)).toBe('SUSPENDED');
  });
});
