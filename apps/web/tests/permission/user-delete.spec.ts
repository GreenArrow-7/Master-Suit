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
import { DELETE as identityDelete } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/[action]/route';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser, type Grants } from '../helpers/fixtures';
import { del } from '../helpers/request';

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
  for (const [module, action] of grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: created.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
    });
  }
  return created;
}

/** A disposable member to delete, at a rank below the administrator's. */
async function member(label: string, roleId: string) {
  return createWorkspaceUser({
    tenantId,
    roleId,
    email: `${label}-${suffix}@userdel.test`,
    fullName: `${label} Person`,
  });
}

let adminRoleId = '';
let staffRoleId = '';

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'User Delete LLC', displayName: 'User Delete', status: 'ACTIVE' },
  });
  tenantId = tenant.id;

  // rank 10 matches ADMIN_ROLE_RANK, so these count as administrators for the
  // last-admin guard — the same shape the seed gives Organization Administrator.
  const orgAdmin = await role('orgadmin', 10, [
    ['users', 'VIEW'],
    ['users', 'MANAGE_USERS'],
    ['users', 'DELETE'],
  ]);
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

  orgAdminCookie = await createSessionToken(tenantId, admin.id);
  managerOnlyCookie = await createSessionToken(tenantId, manager.id);
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
