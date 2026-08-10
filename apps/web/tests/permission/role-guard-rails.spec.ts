/**
 * HRMS-v21 §1 guard rails, driven through the roles route:
 *
 *   - only a top-tier administrator grants or revokes the top-tier role;
 *     everyone else stays strictly below their own level;
 *   - you cannot revoke your own last administrative role (lock-out guard);
 *   - a role with assignment history cannot be deleted, only deactivated —
 *     and a deactivated role grants nothing and cannot be assigned.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { POST as rolesPost } from '@/app/api/v1/workspaces/[workspaceSlug]/roles/[action]/route';
import { GET as leadsList } from '@/app/api/v1/leads/route';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser } from '../helpers/fixtures';
import { get, post } from '../helpers/request';
import type { PermissionAction } from '@prisma/client';

const suffix = randomBytes(4).toString('hex');
const slug = `rails-${suffix}`;

let tenantId = '';
let topCookie = '';
let midCookie = '';
let topRoleId = '';
let midRoleId = '';
let midUserId = '';

const at = (action: string) => ({
  path: `/api/v1/workspaces/${slug}/roles/${action}`,
  params: { workspaceSlug: slug, action },
});

async function grantOn(roleId: string, module: string, action: PermissionAction, scope = 'ORGANIZATION') {
  const permission = await prisma.permission.upsert({
    where: { module_action: { module, action } },
    update: {},
    create: { module, action },
  });
  await prisma.rolePermission.create({
    data: { tenantId, roleId, permissionId: permission.id, granted: true, scope: scope as never },
  });
}

const membershipOf = (userId: string) =>
  prisma.workspaceMembership.findFirstOrThrow({ where: { tenantId, salesUserId: userId } });

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Rails LLC', displayName: 'Rails', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const top = await prisma.role.create({
    data: { tenantId, key: `top-${suffix}`, name: 'Top Admin', rank: 0, defaultScope: 'ORGANIZATION' },
  });
  topRoleId = top.id;
  const mid = await prisma.role.create({
    data: { tenantId, key: `mid-${suffix}`, name: 'Mid Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  midRoleId = mid.id;
  for (const roleId of [top.id, mid.id]) {
    await grantOn(roleId, 'roles', 'MANAGE_CONFIGURATION');
    await grantOn(roleId, 'roles', 'VIEW');
  }
  // The clone test copies a leads grant, and clone caps at the cloner's own
  // ceiling — so the top administrator must hold it to copy it.
  await grantOn(top.id, 'leads', 'VIEW');

  const topUser = await createWorkspaceUser({
    tenantId,
    roleId: top.id,
    email: `top-${suffix}@rails.test`,
    fullName: 'Top Admin',
  });
  topCookie = await createSessionToken(tenantId, topUser.id);

  const midUser = await createWorkspaceUser({
    tenantId,
    roleId: mid.id,
    email: `mid-${suffix}@rails.test`,
    fullName: 'Mid Admin',
  });
  midUserId = midUser.id;
  midCookie = await createSessionToken(tenantId, midUser.id);
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('who may grant which role', () => {
  it('a top-tier administrator grants the top-tier role to a peer', async () => {
    const membership = await membershipOf(midUserId);
    const res = await post(
      rolesPost,
      at('assign').path,
      { membershipId: membership.id, roleId: topRoleId },
      topCookie,
      at('assign').params,
    );
    expect(res.status).toBe(200);
    // Clean up: the grant itself was the test.
    await prisma.membershipRole.deleteMany({ where: { tenantId, roleId: topRoleId } });
  });

  it('a mid-tier administrator can grant neither the top role nor their own level', async () => {
    // The previous test's grant revoked mid's sessions — that revocation is
    // itself correct behaviour — so this test signs in afresh.
    midCookie = await createSessionToken(tenantId, midUserId);
    const membership = await membershipOf(midUserId);
    const above = await post(
      rolesPost,
      at('assign').path,
      { membershipId: membership.id, roleId: topRoleId },
      midCookie,
      at('assign').params,
    );
    expect(above.status).toBe(403);

    const peer = await post(
      rolesPost,
      at('assign').path,
      { membershipId: membership.id, roleId: midRoleId },
      midCookie,
      at('assign').params,
    );
    expect(peer.status).toBe(403);
  });
});

describe('the lock-out guard', () => {
  it('refuses revoking your own last administrative role', async () => {
    // An operator whose primary role is powerless, holding administration only
    // through one assignment — v21's exact lock-out scenario.
    const powerless = await prisma.role.create({
      data: { tenantId, key: `plain-${suffix}`, name: 'Plain', rank: 80, defaultScope: 'OWN' },
    });
    const adminish = await prisma.role.create({
      data: { tenantId, key: `deputy-${suffix}`, name: 'Deputy Admin', rank: 20, defaultScope: 'ORGANIZATION' },
    });
    await grantOn(adminish.id, 'roles', 'MANAGE_CONFIGURATION');
    await grantOn(adminish.id, 'roles', 'VIEW');

    const deputy = await createWorkspaceUser({
      tenantId,
      roleId: powerless.id,
      email: `deputy-${suffix}@rails.test`,
      fullName: 'Deputy',
    });
    const membership = await membershipOf(deputy.id);
    const assignment = await prisma.membershipRole.create({
      data: { tenantId, membershipId: membership.id, roleId: adminish.id, status: 'ACTIVE' },
    });
    const deputyCookie = await createSessionToken(tenantId, deputy.id);

    const res = await post(
      rolesPost,
      at('revoke').path,
      { assignmentId: assignment.id, reason: 'stepping down' },
      deputyCookie,
      at('revoke').params,
    );
    expect(res.status).toBe(409);

    // The top administrator, whose primary role keeps them admin, may revoke it.
    const byTop = await post(
      rolesPost,
      at('revoke').path,
      { assignmentId: assignment.id, reason: 'cover ended' },
      topCookie,
      at('revoke').params,
    );
    expect(byTop.status).toBe(200);
  });
});

describe('deactivation instead of deletion', () => {
  it('walks the whole v21 lifecycle: history blocks delete, deactivation kills the grant', async () => {
    // A viewer role that really grants something observable.
    const viewer = await prisma.role.create({
      data: { tenantId, key: `viewer-${suffix}`, name: 'Viewer', rank: 40, defaultScope: 'ORGANIZATION' },
    });
    await grantOn(viewer.id, 'leads', 'VIEW');

    const holder = await createWorkspaceUser({
      tenantId,
      roleId: (await prisma.role.create({
        data: { tenantId, key: `none-${suffix}`, name: 'None', rank: 85, defaultScope: 'OWN' },
      })).id,
      email: `holder-${suffix}@rails.test`,
      fullName: 'Holder',
    });
    const membership = await membershipOf(holder.id);
    await prisma.membershipRole.create({
      data: { tenantId, membershipId: membership.id, roleId: viewer.id, status: 'ACTIVE' },
    });
    const holderCookie = await createSessionToken(tenantId, holder.id);

    // The assignment works…
    expect((await get(leadsList, '/api/v1/leads', holderCookie)).status).toBe(200);

    // …so the role now has history and cannot be deleted…
    const del = await post(rolesPost, at('delete').path, { roleId: viewer.id }, topCookie, at('delete').params);
    expect(del.status).toBe(409);

    // …but it can be deactivated, and the grant dies with it.
    const off = await post(
      rolesPost,
      at('update').path,
      { roleId: viewer.id, isActive: false },
      topCookie,
      at('update').params,
    );
    expect(off.status).toBe(200);
    const refreshedCookie = await createSessionToken(tenantId, holder.id);
    expect((await get(leadsList, '/api/v1/leads', refreshedCookie)).status).toBe(403);

    // A deactivated role cannot be assigned to anyone else.
    const midMembership = await membershipOf(midUserId);
    const assignInactive = await post(
      rolesPost,
      at('assign').path,
      { membershipId: midMembership.id, roleId: viewer.id },
      topCookie,
      at('assign').params,
    );
    expect(assignInactive.status).toBe(409);
  });

  it('clone copies the permission rows onto a fresh role', async () => {
    const source = await prisma.role.create({
      data: { tenantId, key: `src-${suffix}`, name: 'Source', rank: 45, defaultScope: 'ORGANIZATION' },
    });
    await grantOn(source.id, 'leads', 'VIEW');

    const res = await post(
      rolesPost,
      at('clone').path,
      { sourceRoleId: source.id, key: `copy-${suffix}`, name: 'Source Copy', rank: 46 },
      topCookie,
      at('clone').params,
    );
    expect(res.status).toBe(200);
    const copied = await prisma.rolePermission.count({ where: { tenantId, roleId: res.body.id, granted: true } });
    expect(copied).toBe(1);
  });
});
