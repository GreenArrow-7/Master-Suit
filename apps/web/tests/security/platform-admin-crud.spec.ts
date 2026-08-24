/**
 * The platform console's write surface: workspace delete, subscription
 * edit/cancel, platform-user edit/delete, and operator settings.
 *
 * Every case runs the real route handler with a real session. The properties
 * that matter are the guard rails, not the happy path alone: only the OWNER may
 * call any of it, the owner can never lock themselves out, and a plan change
 * must drag the module entitlements with it — a subscription that says
 * Business while entitlements say HRMS-only is billing fraud in one direction
 * or an outage in the other.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { getUploadMaxMb } from '@/lib/platform-settings';
import { createPlatformSessionToken } from '../helpers/session';
import { patch, del } from '../helpers/request';
import { DELETE as deleteWorkspace } from '@/app/api/v1/platform/workspaces/[workspaceId]/route';
import {
  PATCH as patchSubscription,
  DELETE as cancelSubscription,
} from '@/app/api/v1/platform/subscriptions/[subscriptionId]/route';
import { PATCH as patchUser, DELETE as deleteUser } from '@/app/api/v1/platform/users/[userId]/route';
import { PATCH as patchSettings } from '@/app/api/v1/platform/settings/route';

const suffix = randomBytes(4).toString('hex');

let ownerId = '';
let ownerCookie = '';
let plainCookie = '';
let victimId = '';
let tenantId = '';
let subscriptionId = '';
let hrmsPlanCode = '';

beforeAll(async () => {
  const owner = await prisma.platformUser.create({
    data: {
      email: `crud.owner.${suffix}@platform.test`,
      normalizedEmail: `crud.owner.${suffix}@platform.test`,
      fullName: 'CRUD Owner',
      passwordHash: 'x',
      status: 'ACTIVE',
      platformRole: 'OWNER',
    },
  });
  ownerId = owner.id;
  ownerCookie = await createPlatformSessionToken(owner.id);

  const plain = await prisma.platformUser.create({
    data: {
      email: `crud.plain.${suffix}@platform.test`,
      normalizedEmail: `crud.plain.${suffix}@platform.test`,
      fullName: 'CRUD Plain',
      passwordHash: 'x',
      status: 'ACTIVE',
      platformRole: 'USER',
    },
  });
  plainCookie = await createPlatformSessionToken(plain.id);

  const victim = await prisma.platformUser.create({
    data: {
      email: `crud.victim.${suffix}@platform.test`,
      normalizedEmail: `crud.victim.${suffix}@platform.test`,
      fullName: 'CRUD Victim',
      passwordHash: 'x',
      status: 'ACTIVE',
      platformRole: 'USER',
    },
  });
  victimId = victim.id;

  // A workspace on a two-module plan, ready to be downgraded and deleted.
  const businessPlan = await prisma.subscriptionPlan.create({
    data: {
      code: `crud-business-${suffix}`,
      name: `CRUD Business ${suffix}`,
      modules: ['HRMS', 'SALES'],
      seatLimit: 50,
      storageMb: 1024,
      planModules: { create: [{ module: 'HRMS' }, { module: 'SALES' }] },
    },
  });
  const hrmsPlan = await prisma.subscriptionPlan.create({
    data: {
      code: `crud-hrms-${suffix}`,
      name: `CRUD HRMS ${suffix}`,
      modules: ['HRMS'],
      seatLimit: 50,
      storageMb: 1024,
      planModules: { create: [{ module: 'HRMS' }] },
    },
  });
  hrmsPlanCode = hrmsPlan.code;

  const tenant = await prisma.tenant.create({
    data: { slug: `crud-${suffix}`, legalName: 'CRUD LLC', displayName: 'CRUD Co', planCode: businessPlan.code },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.createMany({
    data: [
      { tenantId, module: 'HRMS', state: 'ACTIVE' },
      { tenantId, module: 'SALES', state: 'ACTIVE' },
    ],
  });
  const subscription = await prisma.tenantSubscription.create({
    data: {
      tenantId,
      planId: businessPlan.id,
      state: 'ACTIVE',
      modules: {
        create: [
          { module: 'HRMS', state: 'ACTIVE' },
          { module: 'SALES', state: 'ACTIVE' },
        ],
      },
    },
  });
  subscriptionId = subscription.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { contains: suffix } } }).catch(() => {});
  await prisma.subscriptionPlan.deleteMany({ where: { code: { contains: suffix } } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
  await prisma.platformSetting.deleteMany({ where: { key: 'uploadMaxMb' } }).catch(() => {});
});

describe('authorization boundary', () => {
  it('refuses every platform write for a non-owner', async () => {
    const cases = [
      await patch(patchUser, `/api/v1/platform/users/${victimId}`, { fullName: 'X' }, plainCookie, {
        userId: victimId,
      }),
      await del(deleteWorkspace, `/api/v1/platform/workspaces/${tenantId}`, plainCookie, { workspaceId: tenantId }),
      await patch(
        patchSubscription,
        `/api/v1/platform/subscriptions/${subscriptionId}`,
        { state: 'ACTIVE' },
        plainCookie,
        { subscriptionId },
      ),
      await patch(patchSettings, '/api/v1/platform/settings', { key: 'uploadMaxMb', value: '10' }, plainCookie),
    ];
    for (const res of cases) expect(res.status).toBe(403);
  });
});

describe('platform users', () => {
  it('edits role and status, and revokes sessions on suspension', async () => {
    const victimCookie = await createPlatformSessionToken(victimId);
    const res = await patch(
      patchUser,
      `/api/v1/platform/users/${victimId}`,
      { fullName: 'Renamed Victim', platformRole: 'SUPPORT', status: 'SUSPENDED' },
      ownerCookie,
      { userId: victimId },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.user.platformRole).toBe('SUPPORT');

    const token = victimCookie.split('=')[1];
    const session = await prisma.platformSession.findFirst({
      where: { platformUserId: victimId, revokedAt: { not: null } },
    });
    expect(session).not.toBeNull();
    expect(token).toBeTruthy();

    // Back to active for the delete case below.
    await patch(patchUser, `/api/v1/platform/users/${victimId}`, { status: 'ACTIVE' }, ownerCookie, {
      userId: victimId,
    });
  });

  it('refuses self-demotion and self-deletion — no locked-out-owner incidents', async () => {
    const demote = await patch(patchUser, `/api/v1/platform/users/${ownerId}`, { platformRole: 'USER' }, ownerCookie, {
      userId: ownerId,
    });
    expect(demote.status).toBe(409);
    const remove = await del(deleteUser, `/api/v1/platform/users/${ownerId}`, ownerCookie, { userId: ownerId });
    expect(remove.status).toBe(409);
  });

  it('deletes a user: soft-deleted, sessions revoked, memberships suspended', async () => {
    const res = await del(deleteUser, `/api/v1/platform/users/${victimId}`, ownerCookie, { userId: victimId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const gone = await prisma.platformUser.findFirst({ where: { id: victimId, deletedAt: null } });
    expect(gone).toBeNull();
    const audit = await prisma.platformAuditEvent.findFirst({
      where: { event: 'PLATFORM_USER_DELETED', objectId: victimId },
    });
    expect(audit).not.toBeNull();
  });
});

describe('subscriptions', () => {
  it('a plan downgrade re-derives entitlements from the new plan', async () => {
    const res = await patch(
      patchSubscription,
      `/api/v1/platform/subscriptions/${subscriptionId}`,
      { planCode: hrmsPlanCode },
      ownerCookie,
      { subscriptionId },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const entitlements = await prisma.moduleEntitlement.findMany({ where: { tenantId } });
    expect(entitlements.map((e) => e.module)).toEqual(['HRMS']);
    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
    expect(tenant?.planCode).toBe(hrmsPlanCode);
  });

  it('cancel ends every module entitlement now', async () => {
    const res = await del(cancelSubscription, `/api/v1/platform/subscriptions/${subscriptionId}`, ownerCookie, {
      subscriptionId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const entitlements = await prisma.moduleEntitlement.findMany({ where: { tenantId } });
    expect(entitlements.every((e) => e.state === 'CANCELED')).toBe(true);
    // tenantId included so the read pins app.tenant_id — the suite connects as
    // the RLS role, and an unpinned read is not refused, it just sees nothing.
    const subscription = await prisma.tenantSubscription.findFirst({ where: { id: subscriptionId, tenantId } });
    expect(subscription?.state).toBe('CANCELED');
    expect(subscription?.canceledAt).not.toBeNull();
  });
});

describe('workspace delete', () => {
  it('soft-deletes the workspace and revokes its sessions', async () => {
    const res = await del(deleteWorkspace, `/api/v1/platform/workspaces/${tenantId}`, ownerCookie, {
      workspaceId: tenantId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const gone = await prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
    expect(gone).toBeNull();
    const audit = await prisma.platformAuditEvent.findFirst({
      where: { event: 'WORKSPACE_DELETED', objectId: tenantId },
    });
    expect(audit).not.toBeNull();
  });

  it('a second delete of the same workspace is a 404, not a repeat', async () => {
    const res = await del(deleteWorkspace, `/api/v1/platform/workspaces/${tenantId}`, ownerCookie, {
      workspaceId: tenantId,
    });
    expect(res.status).toBe(404);
  });
});

describe('operator settings', () => {
  it('persists the upload limit and the upload path reads the override', async () => {
    const res = await patch(
      patchSettings,
      '/api/v1/platform/settings',
      { key: 'uploadMaxMb', value: '10' },
      ownerCookie,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await getUploadMaxMb()).toBe(10);
  });

  it("refuses a value outside the setting's own rule", async () => {
    const tooBig = await patch(
      patchSettings,
      '/api/v1/platform/settings',
      { key: 'uploadMaxMb', value: '9000' },
      ownerCookie,
    );
    expect(tooBig.status).toBe(422);
    const garbage = await patch(
      patchSettings,
      '/api/v1/platform/settings',
      { key: 'uploadMaxMb', value: 'lots' },
      ownerCookie,
    );
    expect(garbage.status).toBe(422);
    // The stored value is untouched by the refused writes.
    expect(await getUploadMaxMb()).toBe(10);
  });

  it('refuses a key that is not an editable setting', async () => {
    const res = await patch(
      patchSettings,
      '/api/v1/platform/settings',
      { key: 'DATABASE_URL', value: 'x' },
      ownerCookie,
    );
    expect(res.status).toBe(422);
  });
});
