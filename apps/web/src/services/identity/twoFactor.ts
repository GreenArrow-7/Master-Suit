/**
 * Two-factor authentication: enrolment, recovery codes, disable, HR removal.
 *
 * Ported from the original HRMS `app/services/totp.py` and the 2FA half of
 * `app/api/auth.py`. The TOTP arithmetic itself already existed in
 * `src/lib/auth/mfa.ts`; this is the lifecycle around it.
 *
 * Three decisions worth stating:
 *
 * 1. **Enrolment is two steps.** The secret is issued but MFA is not switched on
 *    until the user proves a working code. Enabling on issue locks people out of
 *    their own account when the QR scan silently failed.
 * 2. **Recovery codes are hashed, not stored.** They are passwords by another
 *    name. They are shown once, at generation, and single-use thereafter.
 * 3. **HR can remove a factor but never read one.** The authenticator on a phone
 *    someone no longer has is a real support case; being able to *see* the secret
 *    would let HR mint that person's codes indefinitely.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma, withTx } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { verifyPassword } from '@/lib/auth/password';
import { revokeAllSessions } from '@/lib/auth/session';
import { generateSecret, otpauthUrl, verifyTotp } from '@/lib/auth/mfa';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { decryptSecret, encryptSecret } from './secrets';

const RECOVERY_CODE_COUNT = 10;

const hashCode = (code: string) => createHash('sha256').update(code.replace(/\s|-/g, '').toUpperCase()).digest('hex');

/** Grouped for legibility when read aloud down a phone line. */
function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/**
 * The one place that legitimately loads the credential columns: every caller
 * below verifies a TOTP code, a recovery code or a password against them.
 * The returned object is never handed back to a caller as-is — each exported
 * function projects it — and lib/api/handler.ts scrubs the same keys on egress.
 */
async function platformUserFor(ctx: Ctx, userId = ctx.actor.id) {
  const membership = await prisma.workspaceMembership.findUnique({
    where: { salesUserId: userId },
    include: { platformUser: true },
  });
  if (!membership?.platformUser) throw NotFound('User');
  return membership.platformUser;
}

// ── Enrolment ──────────────────────────────────────────────────────────────

/**
 * Step one: issue a secret and the otpauth URL the authenticator scans. Nothing
 * is switched on yet, and calling this again before confirming simply replaces
 * the pending secret.
 */
export async function beginTotpEnrolment(ctx: Ctx) {
  const user = await platformUserFor(ctx);
  if (user.mfaEnabled)
    throw Conflict('Two-factor authentication is already enabled. Disable it first if you want to re-enrol.');

  const secret = generateSecret();
  await prisma.platformUser.update({ where: { id: user.id }, data: { mfaSecret: encryptSecret(secret) } });

  return {
    secret,
    otpauthUrl: otpauthUrl(secret, user.email),
    note: 'Scan this with an authenticator app, then confirm with a code. Two-factor authentication is not active until you do.',
  };
}

/**
 * Step two: prove a working code. Only now is MFA switched on, and the recovery
 * codes are returned once — they are not retrievable afterwards.
 */
export async function confirmTotpEnrolment(ctx: Ctx, code: string) {
  const user = await platformUserFor(ctx);
  if (user.mfaEnabled) throw Conflict('Two-factor authentication is already enabled.');
  if (!user.mfaSecret) throw Conflict('Start enrolment before confirming a code.');
  if (!verifyTotp(decryptSecret(user.mfaSecret), code)) {
    throw Forbidden('That code did not match. Check your authenticator clock and try the current code.');
  }

  const codes = generateRecoveryCodes();
  await prisma.platformUser.update({
    where: { id: user.id },
    data: { mfaEnabled: true, mfaRecoveryCodes: codes.map(hashCode) },
  });
  await prisma.authenticationFactor.create({
    data: { platformUserId: user.id, type: 'TOTP', verifiedAt: new Date() },
  });

  await audit(ctx, {
    event: 'MFA_ENROLLED',
    objectType: 'platform_user',
    recordId: user.id,
    metadata: { action: 'mfa.enabled' },
  });
  return {
    enabled: true,
    recoveryCodes: codes,
    note: 'Store these somewhere safe. Each works once, they are shown only now, and they are the only way back in if you lose the authenticator.',
  };
}

/** Replaces every recovery code. The previous set stops working immediately. */
export async function regenerateRecoveryCodes(ctx: Ctx, code: string) {
  const user = await platformUserFor(ctx);
  if (!user.mfaEnabled || !user.mfaSecret) throw Conflict('Two-factor authentication is not enabled on this account.');
  if (!verifyTotp(decryptSecret(user.mfaSecret), code)) throw Forbidden('That code did not match.');

  const codes = generateRecoveryCodes();
  await prisma.platformUser.update({ where: { id: user.id }, data: { mfaRecoveryCodes: codes.map(hashCode) } });
  await audit(ctx, {
    event: 'MFA_ENROLLED',
    objectType: 'platform_user',
    recordId: user.id,
    metadata: { action: 'mfa.recovery_codes_regenerated' },
  });
  return { recoveryCodes: codes, note: 'The previous codes no longer work.' };
}

/**
 * Turning MFA off is a downgrade of the account's security, so it needs the
 * password as well as a current code — a borrowed unlocked session should not be
 * able to remove the second factor.
 */
export async function disableTotp(ctx: Ctx, password: string, code: string) {
  const user = await platformUserFor(ctx);
  if (!user.mfaEnabled || !user.mfaSecret) throw Conflict('Two-factor authentication is not enabled on this account.');
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password)))
    throw Forbidden('That password is not correct.');
  if (!verifyTotp(decryptSecret(user.mfaSecret), code)) throw Forbidden('That code did not match.');

  await clearFactors(ctx, user.id);
  await audit(ctx, {
    event: 'MFA_ENROLLED',
    objectType: 'platform_user',
    recordId: user.id,
    metadata: { action: 'mfa.disabled.self' },
  });
  return { enabled: false };
}

/**
 * HR removes the factor when the authenticator is on a phone the person no
 * longer has. Every session is revoked with it: an account whose second factor
 * just changed should be re-authenticated, not left signed in.
 */
export async function removeTotpFor(ctx: Ctx, userId: string) {
  const target = await prisma.user.findFirst({
    where: { tenantId: ctx.tenantId, id: userId, deletedAt: null },
    include: { role: true, workspaceMembership: true },
  });
  if (!target?.workspaceMembership) throw NotFound('User');
  if (target.id !== ctx.actor.id && target.role.rank <= ctx.actor.roleRank) {
    throw Forbidden('You cannot administer an account at or above your own level.');
  }

  await clearFactors(ctx, target.workspaceMembership.platformUserId);
  await revokeAllSessions(ctx.tenantId, target.id, undefined, 'MFA_RESET');
  await audit(ctx, {
    event: 'MFA_ENROLLED',
    objectType: 'user',
    recordId: target.id,
    metadata: { action: 'mfa.removed.by_admin' },
  });
  return { userId: target.id, enabled: false };
}

async function clearFactors(ctx: Ctx, platformUserId: string) {
  // PlatformUser and AuthenticationFactor are identity tables, exempt from RLS;
  // the tenant is declared anyway so every transaction in the codebase does.
  await withTx(ctx.tenantId, async (tx) => {
    await tx.platformUser.update({
      where: { id: platformUserId },
      data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [] },
    });
    await tx.authenticationFactor.deleteMany({ where: { platformUserId, type: 'TOTP' } });
  });
}

/**
 * Spends one recovery code. Called from the login path when the user cannot
 * produce a TOTP code; comparison is constant-time and the code is removed on
 * use, so a captured code is worthless the second time.
 */
export async function consumeRecoveryCode(platformUserId: string, submitted: string): Promise<boolean> {
  const user = await prisma.platformUser.findUnique({
    where: { id: platformUserId },
    select: { mfaRecoveryCodes: true },
  });
  if (!user?.mfaRecoveryCodes.length) return false;

  const candidate = Buffer.from(hashCode(submitted));
  const match = user.mfaRecoveryCodes.find((stored) => {
    const known = Buffer.from(stored);
    return known.length === candidate.length && timingSafeEqual(known, candidate);
  });
  if (!match) return false;

  await prisma.platformUser.update({
    where: { id: platformUserId },
    data: { mfaRecoveryCodes: user.mfaRecoveryCodes.filter((stored) => stored !== match) },
  });
  return true;
}

export async function twoFactorStatus(ctx: Ctx) {
  const user = await platformUserFor(ctx);
  return {
    enabled: user.mfaEnabled,
    pendingSecret: Boolean(user.mfaSecret) && !user.mfaEnabled,
    recoveryCodesRemaining: user.mfaRecoveryCodes.length,
  };
}
