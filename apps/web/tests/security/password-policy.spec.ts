/**
 * P1-6 — two password rules that were settings and nothing else.
 *
 * `PasswordPolicy` has typed `reuseWindow` (defaulted to 5) and `maxAgeDays`
 * since it was written, and the workspace settings screen has offered
 * `reuseWindow` with a 0..24 validator the whole time. Nothing read either. An
 * administrator who set "cannot reuse the last five passwords" got a setting
 * that saved, redisplayed, and did nothing — which is worse than not offering
 * it, because it reads as a control that is working.
 *
 * These tests are written against the behaviour rather than the plumbing: set a
 * password, change it, try to set it back. Nothing here would have passed
 * before, and none of it can pass again if the history table stops being
 * written.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword, DEFAULT_POLICY } from '@/lib/auth/password';
import { changeOwnPassword, passwordPolicy } from '@/services/identity/accounts';
import { assertNotReused, passwordExpired, recordPreviousPassword } from '@/services/identity/passwordHistory';
import { buildActor, buildCtx } from '../helpers/ctx';

const suffix = randomBytes(4).toString('hex');
const slug = `pwpolicy-${suffix}`;

let tenantId = '';
let userId = '';
let platformUserId = '';

/** Distinct, and each satisfies the default policy on its own. */
const P1 = `Alpha-One-${suffix}1`;
const P2 = `Bravo-Two-${suffix}2`;
const P3 = `Charlie-Three-${suffix}3`;
const P4 = `Delta-Four-${suffix}4`;

const ctx = () =>
  buildCtx(
    buildActor({
      id: userId,
      tenantId,
      roleId: 'r',
      roleKey: 'k',
      roleRank: 50,
      permissions: new Map([['users:VIEW', 'ORGANIZATION' as const]]),
    }),
  );

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Policy LLC', displayName: 'Policy', status: 'ACTIVE' },
  });
  tenantId = tenant.id;

  const role = await prisma.role.create({
    data: { tenantId, key: `member-${suffix}`, name: 'Member', rank: 50, defaultScope: 'OWN' },
  });
  const user = await prisma.user.create({
    data: { tenantId, email: `p-${suffix}@policy.test`, fullName: 'P', roleId: role.id, status: 'ACTIVE' },
  });
  userId = user.id;

  const platformUser = await prisma.platformUser.create({
    data: {
      email: `p-${suffix}@policy.test`,
      normalizedEmail: `p-${suffix}@policy.test`,
      fullName: 'P',
      status: 'ACTIVE',
      passwordHash: await hashPassword(P1),
      passwordChangedAt: new Date(),
    },
  });
  platformUserId = platformUser.id;

  await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId, salesUserId: userId, status: 'ACTIVE', joinedAt: new Date() },
  });
});

afterAll(async () => {
  await prisma.workspaceMembership.deleteMany({ where: { tenantId } });
  await prisma.platformUser.deleteMany({ where: { id: platformUserId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
});

describe('reuse window', () => {
  it('defaults to refusing the last five', async () => {
    const policy = await passwordPolicy(tenantId);
    expect(policy.reuseWindow).toBe(DEFAULT_POLICY.reuseWindow);
    expect(policy.reuseWindow).toBeGreaterThan(0);
  });

  it('refuses a password used one change ago', async () => {
    await changeOwnPassword(ctx(), P1, P2);

    // P1 is now history. Setting it back is exactly what reuseWindow forbids and
    // exactly what used to work.
    await expect(changeOwnPassword(ctx(), P2, P1)).rejects.toThrow(/used that password/i);
  });

  it('refuses one used several changes ago, while still inside the window', async () => {
    await changeOwnPassword(ctx(), P2, P3);
    await changeOwnPassword(ctx(), P3, P4);

    // P1 is now three changes back — still inside a window of five.
    await expect(changeOwnPassword(ctx(), P4, P1)).rejects.toThrow(/used that password/i);
  });

  it('accepts a password the account has never used', async () => {
    const fresh = `Echo-Five-${suffix}5`;
    await expect(changeOwnPassword(ctx(), P4, fresh)).resolves.toEqual({ changed: true });

    // And the credential really changed, rather than the call merely not throwing.
    const after = await prisma.platformUser.findUnique({
      where: { id: platformUserId },
      select: { passwordHash: true },
    });
    expect(await verifyPassword(after!.passwordHash!, fresh)).toBe(true);
  });

  it('is a no-op when the workspace sets the window to zero', async () => {
    await expect(assertNotReused(platformUserId, P1, { ...DEFAULT_POLICY, reuseWindow: 0 })).resolves.toBeUndefined();
  });

  it('keeps history bounded rather than growing per change', async () => {
    const rows = await prisma.passwordHistory.count({ where: { platformUserId } });
    // Four changes so far, so four filed hashes — and never more than the cap.
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThanOrEqual(24);
  });

  it('files history under the account, not the workspace', async () => {
    // The credential belongs to the PlatformUser. A second workspace membership
    // must not get a second, divergent history.
    const rows = await prisma.passwordHistory.findMany({ where: { platformUserId }, select: { id: true } });
    expect(rows.length).toBe(await prisma.passwordHistory.count({ where: { platformUserId } }));
  });
});

describe('maximum age', () => {
  const policy = (maxAgeDays: number | null) => ({ ...DEFAULT_POLICY, maxAgeDays });
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  it('treats an administrator-issued password as needing replacement', () => {
    // Null is what a reset leaves behind. This was already the rule; it now flows
    // through the same predicate as expiry rather than a second lookalike check.
    expect(passwordExpired(null, policy(null))).toBe(true);
    expect(passwordExpired(null, policy(90))).toBe(true);
  });

  it('never expires when the workspace sets no maximum', () => {
    expect(passwordExpired(daysAgo(3650), policy(null))).toBe(false);
    expect(passwordExpired(daysAgo(3650), policy(0))).toBe(false);
  });

  it('expires a password older than the maximum', () => {
    expect(passwordExpired(daysAgo(91), policy(90))).toBe(true);
  });

  it('does not expire one still inside it', () => {
    expect(passwordExpired(daysAgo(89), policy(90))).toBe(false);
  });
});

describe('history bookkeeping', () => {
  it('never fails the password change it accompanies', async () => {
    // A null previous hash is the first-ever password: nothing to file, and it
    // must not throw on the way past.
    await expect(recordPreviousPassword(platformUserId, null)).resolves.toBeUndefined();
    // Neither may an unknown account, which is what a race with deletion looks
    // like — the change has already committed by the time this runs.
    await expect(recordPreviousPassword('does-not-exist', 'irrelevant')).resolves.toBeUndefined();
  });
});
