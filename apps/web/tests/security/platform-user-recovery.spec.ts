/**
 * The owner's account-recovery console, tested at the only bar that matters:
 * **after the owner acts, does the user actually get in?**
 *
 * Checking that a row changed in the database is what made the previous round of
 * "password reset successfully" reports wrong — the state looked right and the
 * sign-in still failed. So every case here ends by calling the real login route
 * with the real password, through the real password verifier.
 *
 * The guard rails get the same treatment: a non-owner must not reach any of it,
 * and the last active platform owner must not be able to disarm themselves.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { invalidate } from '@/lib/redis';
import { limits } from '@/lib/security/ratelimit';
import { createPlatformSessionToken } from '../helpers/session';
import { post } from '../helpers/request';
import { POST as actions } from '@/app/api/v1/platform/users/[userId]/actions/route';
import { POST as login } from '@/app/api/v1/auth/login/route';

const suffix = randomBytes(4).toString('hex');
const ORIGINAL = 'OriginalPass-2026';
const REPLACEMENT = 'ReplacedPass-2026';

let ownerId = '';
let ownerCookie = '';
let plainCookie = '';
let userId = '';
let tenantId = '';
let membershipId = '';

/**
 * The real login route, called the way a browser would.
 *
 * The sign-in throttle is cleared first, and that is not cheating — it is the
 * distinction this whole feature exists to make. A spec that signs in a dozen
 * times as one account trips the per-account and per-IP limiters, and a 429 is
 * not an answer to "is this account's password and state correct?". The console
 * draws the same line: the drawer reports the throttle separately from the
 * account lock, precisely so an operator stops mistaking one for the other.
 */
async function signIn(email: string, password: string) {
  await invalidate(`rl:${limits.loginPerAccount(email).key}:*`);
  await invalidate(`rl:${limits.loginPerIp('unknown').key}:*`);
  const req = new Request('http://localhost/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const res = await login(req);
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  const owner = await prisma.platformUser.create({
    data: {
      email: `rec.owner.${suffix}@platform.test`,
      normalizedEmail: `rec.owner.${suffix}@platform.test`,
      fullName: 'Recovery Owner',
      passwordHash: await hashPassword(ORIGINAL),
      passwordChangedAt: new Date(),
      status: 'ACTIVE',
      platformRole: 'OWNER',
    },
  });
  ownerId = owner.id;
  ownerCookie = await createPlatformSessionToken(owner.id);

  const plain = await prisma.platformUser.create({
    data: {
      email: `rec.plain.${suffix}@platform.test`,
      normalizedEmail: `rec.plain.${suffix}@platform.test`,
      fullName: 'Recovery Plain',
      passwordHash: 'x',
      status: 'ACTIVE',
      platformRole: 'USER',
    },
  });
  plainCookie = await createPlatformSessionToken(plain.id);

  // A workspace user, complete enough that login accepts it: an ACTIVE tenant,
  // an ACTIVE membership, and an ACTIVE `User` row behind it. Login checks all
  // three before it ever looks at the password.
  const tenant = await prisma.tenant.create({
    data: { slug: `rec-${suffix}`, legalName: 'Recovery LLC', displayName: 'Recovery Co', planCode: 'free' },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({
    data: { tenantId, key: 'org_admin', name: 'Organization Administrator', rank: 10 },
  });
  const subject = await prisma.platformUser.create({
    data: {
      email: `rec.user.${suffix}@platform.test`,
      normalizedEmail: `rec.user.${suffix}@platform.test`,
      fullName: 'Recovery Subject',
      passwordHash: await hashPassword(ORIGINAL),
      passwordChangedAt: new Date(),
      status: 'ACTIVE',
      platformRole: 'USER',
    },
  });
  userId = subject.id;
  const salesUser = await prisma.user.create({
    data: {
      tenantId,
      email: subject.email,
      fullName: subject.fullName,
      roleId: role.id,
      status: 'ACTIVE',
    },
  });
  const membership = await prisma.workspaceMembership.create({
    data: {
      tenantId,
      platformUserId: subject.id,
      salesUserId: salesUser.id,
      status: 'ACTIVE',
      roleSnapshot: role.key,
      joinedAt: new Date(),
    },
  });
  membershipId = membership.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { contains: suffix } } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
});

describe('authorization boundary', () => {
  it('refuses every recovery action for a non-owner', async () => {
    for (const body of [
      { action: 'reset-password', password: REPLACEMENT, requireChange: false },
      { action: 'unlock' },
      { action: 'reset-mfa' },
      { action: 'set-active', active: false },
    ]) {
      const res = await post(actions, `/api/v1/platform/users/${userId}/actions`, body, plainCookie, { userId });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
    }
    // And the password it tried to set must not have taken.
    const still = await signIn(`rec.user.${suffix}@platform.test`, ORIGINAL);
    expect(still.status).toBe(200);
  });
});

describe('password reset', () => {
  it('sets a chosen password that the login route then accepts', async () => {
    const res = await post(
      actions,
      `/api/v1/platform/users/${userId}/actions`,
      { action: 'reset-password', password: REPLACEMENT, requireChange: false },
      ownerCookie,
      { userId },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // An owner-chosen password is never echoed back — they already know it.
    expect(res.body.temporaryPassword).toBeNull();

    const ok = await signIn(`rec.user.${suffix}@platform.test`, REPLACEMENT);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.mustChangePassword).toBe(false);

    const stale = await signIn(`rec.user.${suffix}@platform.test`, ORIGINAL);
    expect(stale.status).toBe(401);
  });

  it('generates a temporary password, returns it once, and forces a change', async () => {
    const res = await post(
      actions,
      `/api/v1/platform/users/${userId}/actions`,
      { action: 'reset-password', requireChange: true },
      ownerCookie,
      { userId },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const temporary = res.body.temporaryPassword as string;
    expect(temporary).toBeTruthy();

    const ok = await signIn(`rec.user.${suffix}@platform.test`, temporary);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.mustChangePassword).toBe(true);
    expect(ok.body.destination).toContain('/profile/security');
  });

  it('never writes a password into the audit trail', async () => {
    const events = await prisma.platformAuditEvent.findMany({
      where: { objectId: userId, event: 'PASSWORD_RESET' },
    });
    expect(events.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(REPLACEMENT);
    expect(serialised).not.toContain('passwordHash');
  });
});

describe('unlock', () => {
  it('clears a lock that was refusing sign-in before the password was read', async () => {
    await prisma.platformUser.update({
      where: { id: userId },
      data: { lockedUntil: new Date(Date.now() + 3_600_000), failedLoginCount: 9 },
    });
    await post(
      actions,
      `/api/v1/platform/users/${userId}/actions`,
      { action: 'reset-password', password: REPLACEMENT, requireChange: false },
      ownerCookie,
      { userId },
    );
    // Deliberately re-lock: a reset clears the lock, so locking after it is the
    // only way to prove `unlock` is doing the work rather than the reset.
    await prisma.platformUser.update({
      where: { id: userId },
      data: { lockedUntil: new Date(Date.now() + 3_600_000), failedLoginCount: 9 },
    });
    expect((await signIn(`rec.user.${suffix}@platform.test`, REPLACEMENT)).status).toBe(401);

    const res = await post(actions, `/api/v1/platform/users/${userId}/actions`, { action: 'unlock' }, ownerCookie, {
      userId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.wasLocked).toBe(true);

    const after = await signIn(`rec.user.${suffix}@platform.test`, REPLACEMENT);
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    const row = await prisma.platformUser.findUnique({ where: { id: userId } });
    expect(row?.failedLoginCount).toBe(0);
  });
});

describe('account standing and membership', () => {
  it('deactivation stops authentication; reactivation restores it', async () => {
    await post(actions, `/api/v1/platform/users/${userId}/actions`, { action: 'set-active', active: false }, ownerCookie, { userId });
    expect((await signIn(`rec.user.${suffix}@platform.test`, REPLACEMENT)).status).toBe(401);

    await post(actions, `/api/v1/platform/users/${userId}/actions`, { action: 'set-active', active: true }, ownerCookie, { userId });
    expect((await signIn(`rec.user.${suffix}@platform.test`, REPLACEMENT)).status).toBe(200);
  });

  it('suspending the only membership refuses sign-in, and activating repairs it', async () => {
    await post(
      actions,
      `/api/v1/platform/users/${userId}/actions`,
      { action: 'membership-status', membershipId, status: 'SUSPENDED' },
      ownerCookie,
      { userId },
    );
    expect((await signIn(`rec.user.${suffix}@platform.test`, REPLACEMENT)).status).toBe(401);

    // The repair must fix the workspace user too, not just the membership row:
    // login checks both, so half a repair is still a locked-out customer.
    const res = await post(
      actions,
      `/api/v1/platform/users/${userId}/actions`,
      { action: 'membership-status', membershipId, status: 'ACTIVE' },
      ownerCookie,
      { userId },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await signIn(`rec.user.${suffix}@platform.test`, REPLACEMENT)).status).toBe(200);
  });
});

describe('owner lockout safeguards', () => {
  /**
   * The "last active owner" half of the guard counts owners across the whole
   * platform, so exercising it would mean suspending the real ones in a shared
   * test database. What is asserted here is the half that holds
   * unconditionally and catches the accident that actually happens: an owner
   * disabling or demoting themselves, from which the console offers no way back.
   */
  it('refuses to deactivate, demote or MFA-reset your own owner account', async () => {
    for (const body of [
      { action: 'set-active', active: false },
      { action: 'set-platform-role', platformRole: 'USER' },
      { action: 'reset-mfa' },
    ]) {
      const res = await post(actions, `/api/v1/platform/users/${ownerId}/actions`, body, ownerCookie, {
        userId: ownerId,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
    }
    const owner = await prisma.platformUser.findUnique({ where: { id: ownerId } });
    expect(owner?.status).toBe('ACTIVE');
    expect(owner?.platformRole).toBe('OWNER');
  });

  it('lets an owner reset their own password — they still know the new one', async () => {
    const res = await post(
      actions,
      `/api/v1/platform/users/${ownerId}/actions`,
      { action: 'reset-password', password: REPLACEMENT, requireChange: false },
      ownerCookie,
      { userId: ownerId },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});
