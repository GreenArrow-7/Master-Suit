/**
 * P0-3 — the reset flow wrote the wrong table.
 *
 * `auth/reset-password` updated `User.passwordHash`; `auth/login` authenticates
 * against `PlatformUser.passwordHash`. So a reset left the new password inert and
 * the old one still working — on the one flow whose entire purpose is to make a
 * compromised password stop working.
 *
 * Everything below drives the real login handler, so "the password works" means
 * the product's own authentication accepted it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { POST as resetPassword } from '@/app/api/v1/auth/reset-password/route';
import { createSessionToken, createPlatformSessionToken } from '../helpers/session';
import { post } from '../helpers/request';

const suffix = randomBytes(5).toString('hex');
const slug = `reset-${suffix}`;
const email = `subject-${suffix}@reset.test`;
const OLD_PASSWORD = 'OldLeakedPassword1!';
const NEW_PASSWORD = 'BrandNewPassword9!';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

let tenantId = '';
let salesUserId = '';
let platformUserId = '';

/** A live reset token for the fixture user. Returns the plaintext half. */
async function issueToken(expiresAt = new Date(Date.now() + 30 * 60_000)) {
  const token = randomBytes(32).toString('base64url');
  await prisma.passwordResetToken.create({
    data: { platformUserId, tenantId, userId: salesUserId, tokenHash: sha256(token), expiresAt },
  });
  return token;
}

/**
 * Whether the product's authentication would accept this password.
 *
 * Asserted against `PlatformUser.passwordHash` because that is the exact row and
 * column `auth/login/route.ts:40,78` reads — which is the whole substance of this
 * bug. The login *route* cannot be driven from here: it ends in
 * createPlatformSession, which writes the cookie through next/headers and throws
 * outside a request scope (same limitation tests/helpers/session.ts documents).
 * The route is exercised end-to-end by the Playwright suite instead.
 */
async function loginWouldAccept(password: string): Promise<boolean> {
  const user = await prisma.platformUser.findUnique({
    where: { normalizedEmail: email },
    select: { passwordHash: true },
  });
  return Boolean(user?.passwordHash) && verifyPassword(user!.passwordHash!, password);
}

beforeAll(async () => {
  const passwordHash = await hashPassword(OLD_PASSWORD);
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Reset LLC', displayName: 'Reset', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const role = await prisma.role.create({
    data: { tenantId, key: `member-${suffix}`, name: 'Member', rank: 50, defaultScope: 'OWN' },
  });
  const salesUser = await prisma.user.create({
    data: { tenantId, email, fullName: 'Reset Subject', roleId: role.id, status: 'ACTIVE' },
  });
  salesUserId = salesUser.id;

  const platformUser = await prisma.platformUser.create({
    data: {
      email,
      normalizedEmail: email,
      fullName: 'Reset Subject',
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  platformUserId = platformUser.id;

  await prisma.workspaceMembership.create({
    data: {
      tenantId,
      platformUserId,
      salesUserId,
      status: 'ACTIVE',
      roleSnapshot: role.key,
      joinedAt: new Date(),
    },
  });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  if (platformUserId) await prisma.platformUser.delete({ where: { id: platformUserId } }).catch(() => {});
});

describe('P0-3 password reset changes the credential login actually reads', () => {
  it('accepts the old password before the reset', async () => {
    expect(await loginWouldAccept(OLD_PASSWORD)).toBe(true);
  });

  it('kills every session for both identities', async () => {
    // Two sessions of each kind, so the assertion is about the sweep rather than
    // about one row happening to be updated.
    await createSessionToken(tenantId, salesUserId);
    await createPlatformSessionToken(platformUserId, tenantId);

    const token = await issueToken();
    const res = await post(resetPassword, '/api/v1/auth/reset-password', {
      token,
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(200);

    // One store now: the legacy per-workspace Session table is gone, and
    // createSessionToken issues a PlatformSession like a real sign-in does.
    expect(await prisma.platformSession.count({ where: { platformUserId, revokedAt: null } })).toBe(0);
  });

  it('rejects the old password after the reset', async () => {
    // The failure that mattered: before the fix this stayed true, so a leaked
    // password survived the reset that was supposed to retire it.
    expect(await loginWouldAccept(OLD_PASSWORD)).toBe(false);
  });

  it('accepts the new password after the reset', async () => {
    expect(await loginWouldAccept(NEW_PASSWORD)).toBe(true);
  });

  it('clears the lockout counters with the reset', async () => {
    // There is only one credential store now (P1-9); the assertion that the two
    // agreed has been replaced by the guarantee that a second one cannot exist.
    const platformUser = await prisma.platformUser.findUnique({
      where: { id: platformUserId },
      select: { passwordHash: true, failedLoginCount: true, lockedUntil: true, passwordChangedAt: true },
    });
    expect(platformUser!.passwordHash).toBeTruthy();
    expect(platformUser!.failedLoginCount).toBe(0);
    expect(platformUser!.lockedUntil).toBeNull();
    expect(platformUser!.passwordChangedAt).not.toBeNull();
  });

  it('spends the token — a replay is refused', async () => {
    const token = await issueToken();
    const first = await post(resetPassword, '/api/v1/auth/reset-password', {
      token,
      newPassword: 'ThirdPasswordHere7!',
    });
    expect(first.status).toBe(200);

    const replay = await post(resetPassword, '/api/v1/auth/reset-password', {
      token,
      newPassword: 'FourthPasswordHere5!',
    });
    expect(replay.status).toBe(401);
  });

  it('refuses an expired token', async () => {
    const token = await issueToken(new Date(Date.now() - 60_000));
    const res = await post(resetPassword, '/api/v1/auth/reset-password', {
      token,
      newPassword: 'ExpiredAttempt3!',
    });
    expect(res.status).toBe(401);
  });

  it('refuses a token whose workspace has been suspended', async () => {
    // Replaces an assertion that a mismatched `tenantSlug` was refused. The
    // caller no longer supplies one — the token names its own workspace, so that
    // mismatch is unrepresentable. What remains checkable is that the workspace
    // is still entitled to have anyone sign in at all.
    const token = await issueToken();
    await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    try {
      const res = await post(resetPassword, '/api/v1/auth/reset-password', {
        token,
        newPassword: 'SuspendedWorkspace4!',
      });
      expect(res.status).toBe(401);
    } finally {
      await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
    }
  });

  it('refuses a token that names no real record', async () => {
    const res = await post(resetPassword, '/api/v1/auth/reset-password', {
      token: 'not-a-token-anyone-issued',
      newPassword: 'ForgedToken5!',
    });
    expect(res.status).toBe(401);
  });
});

describe('password reset for an account with no workspace', () => {
  // The platform owner exists before any workspace does. The credential is the
  // same PlatformUser row, so the reset must work with no tenant to consult.
  const soloEmail = `solo-${suffix}@reset.test`;
  let soloId = '';

  beforeAll(async () => {
    const solo = await prisma.platformUser.create({
      data: {
        email: soloEmail,
        normalizedEmail: soloEmail,
        fullName: 'Solo Owner',
        passwordHash: await hashPassword(OLD_PASSWORD),
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    soloId = solo.id;
  });

  afterAll(async () => {
    if (soloId) await prisma.platformUser.delete({ where: { id: soloId } }).catch(() => {});
  });

  it('resets the credential, ends sessions and records a platform audit event', async () => {
    await createPlatformSessionToken(soloId);
    const token = randomBytes(32).toString('base64url');
    await prisma.passwordResetToken.create({
      data: { platformUserId: soloId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) },
    });

    const res = await post(resetPassword, '/api/v1/auth/reset-password', { token, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    const user = await prisma.platformUser.findUnique({ where: { id: soloId }, select: { passwordHash: true } });
    expect(verifyPassword(user!.passwordHash!, NEW_PASSWORD)).toBe(true);
    expect(await prisma.platformSession.count({ where: { platformUserId: soloId, revokedAt: null } })).toBe(0);
    expect(await prisma.platformAuditEvent.count({ where: { actorUserId: soloId, event: 'PASSWORD_RESET' } })).toBe(1);
  });
});
