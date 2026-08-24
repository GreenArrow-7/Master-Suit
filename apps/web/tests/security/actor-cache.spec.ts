import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, withPlatformTx } from '@/lib/db';
import { ctxForUser } from '@/lib/auth/session';
import { __resetActorCacheForTests } from '@/lib/auth/actorCache';

/**
 * The permission cache, tested for the thing a permission cache breaks.
 *
 * `buildActor` ran three queries with deep includes on every authenticated
 * request, and section 18 puts that at the binding constraint around 300
 * organizations. Caching it is straightforward; caching it *without making a
 * revoked permission keep working* is the whole job, and that is what these
 * assert.
 *
 * Every case here has the same shape: read the permission, change it, read it
 * again in a fresh call, and require the second read to reflect the change. A
 * test that only checked "the second call is faster" would pass against a cache
 * with no invalidation at all — which is the bug worth catching.
 */

const suffix = randomBytes(4).toString('hex');
let tenantId = '';
let userId = '';
let roleId = '';
let leadViewId = '';

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `ac-${suffix}`, legalName: `AC ${suffix}`, displayName: `AC ${suffix}` },
  });
  tenantId = tenant.id;

  const role = await prisma.role.create({
    data: { tenantId, key: `rep-${suffix}`, name: 'Rep', rank: 60, defaultScope: 'OWN' },
  });
  roleId = role.id;

  const permission = await prisma.permission.findFirst({ where: { module: 'leads', action: 'VIEW' } });
  leadViewId = permission!.id;
  await prisma.rolePermission.create({
    data: { tenantId, roleId, permissionId: leadViewId, granted: true, scope: 'ORGANIZATION' },
  });

  const user = await prisma.user.create({
    data: { tenantId, email: `ac-${suffix}@test.local`, fullName: 'Cache Subject', roleId, status: 'ACTIVE' },
  });
  userId = user.id;
});

afterAll(async () => {
  await withPlatformTx(async (tx) => {
    if (tenantId) await tx.tenant.delete({ where: { id: tenantId } });
  });
});

beforeEach(async () => {
  await __resetActorCacheForTests();
});

const actor = async () => (await ctxForUser(userId, tenantId, `req-${randomBytes(3).toString('hex')}`)).actor;

describe('the cache itself', () => {
  it('returns the same permission set on a second call', async () => {
    const first = await actor();
    const second = await actor();
    expect(second.permissions.get('leads:VIEW')).toBe('ORGANIZATION');
    expect([...second.permissions]).toEqual([...first.permissions]);
    expect(second.roleRank).toBe(first.roleRank);
  });

  it('rehydrates the permission map as a Map, not a plain object', async () => {
    // JSON has no Map. Round-tripping one as `{}` would make every
    // `permissions.get(...)` return undefined — every caller denied, everywhere,
    // and only on a cache hit.
    await actor();
    const cached = await actor();
    expect(cached.permissions).toBeInstanceOf(Map);
    expect(cached.permissions.get('leads:VIEW')).toBe('ORGANIZATION');
  });

  it('keeps array fields as arrays', async () => {
    await actor();
    const cached = await actor();
    expect(Array.isArray(cached.teamIds)).toBe(true);
    expect(Array.isArray(cached.managedUserIds)).toBe(true);
    expect(Array.isArray(cached.grantedBranchIds)).toBe(true);
  });
});

describe('revocation is immediate', () => {
  it('drops a permission the moment the RolePermission row says so', async () => {
    expect((await actor()).permissions.get('leads:VIEW')).toBe('ORGANIZATION');

    await prisma.rolePermission.updateMany({
      where: { tenantId, roleId, permissionId: leadViewId },
      data: { granted: false },
    });

    // No sleep, no TTL. The write itself invalidated the tenant.
    expect((await actor()).permissions.get('leads:VIEW')).toBeUndefined();

    await prisma.rolePermission.updateMany({
      where: { tenantId, roleId, permissionId: leadViewId },
      data: { granted: true },
    });
    expect((await actor()).permissions.get('leads:VIEW')).toBe('ORGANIZATION');
  });

  it('narrows a scope the moment the row says so', async () => {
    expect((await actor()).permissions.get('leads:VIEW')).toBe('ORGANIZATION');
    await prisma.rolePermission.updateMany({
      where: { tenantId, roleId, permissionId: leadViewId },
      data: { scope: 'OWN' },
    });
    expect((await actor()).permissions.get('leads:VIEW')).toBe('OWN');
    await prisma.rolePermission.updateMany({
      where: { tenantId, roleId, permissionId: leadViewId },
      data: { scope: 'ORGANIZATION' },
    });
  });

  it('takes everything away when the role is deactivated', async () => {
    // Deactivation is meant to be a real off-switch, not a display state.
    expect((await actor()).permissions.size).toBeGreaterThan(0);
    await prisma.role.updateMany({ where: { tenantId, id: roleId }, data: { isActive: false } });
    expect((await actor()).permissions.size).toBe(0);
    await prisma.role.updateMany({ where: { tenantId, id: roleId }, data: { isActive: true } });
    expect((await actor()).permissions.size).toBeGreaterThan(0);
  });

  it('refuses a user who has been deactivated', async () => {
    await actor();
    await prisma.user.updateMany({ where: { tenantId, id: userId }, data: { status: 'DEACTIVATED' } });
    // A cached actor must not outlive the account it belongs to.
    await expect(actor()).rejects.toThrow();
    await prisma.user.updateMany({ where: { tenantId, id: userId }, data: { status: 'ACTIVE' } });
    await expect(actor()).resolves.toBeTruthy();
  });

  it('picks up a change to who this user manages', async () => {
    // managedUserIds is the case a per-user invalidation gets wrong: the row
    // that changed belongs to the *report*, and the actor that has to be
    // rebuilt is the manager's.
    expect((await actor()).managedUserIds).toHaveLength(0);

    const report = await prisma.user.create({
      data: {
        tenantId,
        email: `report-${suffix}@test.local`,
        fullName: 'Report',
        roleId,
        status: 'ACTIVE',
        managerId: userId,
      },
    });
    expect((await actor()).managedUserIds).toEqual([report.id]);

    await prisma.user.updateMany({ where: { tenantId, id: report.id }, data: { managerId: null } });
    expect((await actor()).managedUserIds).toHaveLength(0);
  });
});

describe('what must not invalidate', () => {
  it('leaves the cache alone for a User write that touches no permission field', async () => {
    // A profile edit — a phone number, an avatar, a timezone — must not clear
    // the tenant's cache. If ordinary user writes invalidated it, the cache
    // would be cold for everyone whenever anybody changed anything, which is a
    // cache that costs a Redis round trip and saves nothing.
    const before = await actor();
    await prisma.user.updateMany({
      where: { tenantId, id: userId },
      data: { phone: '+971500000000', timezone: 'Asia/Dubai' },
    });

    // Asserted through the version counter rather than through timing, which
    // would be flaky: the cached entry is still readable, so it is still valid.
    const { readCachedActor } = await import('@/lib/auth/actorCache');
    const stillCached = await readCachedActor(tenantId, userId);
    expect(stillCached).not.toBeNull();
    expect(stillCached!.id).toBe(before.id);
  });

  it('does not let one tenant’s role edit invalidate another’s', async () => {
    const other = await prisma.tenant.create({
      data: { slug: `ac2-${suffix}`, legalName: 'Other', displayName: 'Other' },
    });
    try {
      const otherRole = await prisma.role.create({
        data: { tenantId: other.id, key: `rep-${suffix}`, name: 'Rep', rank: 60, defaultScope: 'OWN' },
      });
      await actor(); // warm this tenant

      await prisma.role.updateMany({ where: { tenantId: other.id, id: otherRole.id }, data: { rank: 10 } });

      const { readCachedActor } = await import('@/lib/auth/actorCache');
      expect(await readCachedActor(tenantId, userId)).not.toBeNull();
    } finally {
      await withPlatformTx((tx) => tx.tenant.delete({ where: { id: other.id } }));
    }
  });
});
