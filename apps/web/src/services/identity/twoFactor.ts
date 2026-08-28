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

/**
 * Bytes of randomness per recovery code.
 *
 * Was 5 — forty bits. A recovery code bypasses the second factor outright, and
 * these are stored as a plain SHA-256 digest, so the only thing standing between
 * a leaked database and a working 2FA bypass is the cost of guessing the input.
 * Forty bits against a fast hash is roughly a trillion candidates: minutes on one
 * consumer GPU, for every account in the table at once, because an unsalted
 * digest lets one pass cover them all.
 *
 * Ten bytes puts it at 2^80, which is not reachable by anyone. The password
 * (Argon2id) and the TOTP secret (AES-256-GCM, key held outside the database)
 * were never the weak link here; this was.
 */
const RECOVERY_CODE_BYTES = 10;

/**
 * A fast digest is the right choice *at this entropy*, and was the wrong one at
 * the old length.
 *
 * Argon2 exists to make guessing expensive when the secret is guessable — a
 * human-chosen password. A random 80-bit value is not guessable, so the slow
 * hash would buy nothing and would cost ten verifications per login attempt,
 * since a submitted code has to be checked against every stored digest. This is
 * the same reasoning session, reset and invitation tokens already use.
 *
 * Normalisation is what lets a person type the code back with or without the
 * grouping hyphens, and it must stay identical on both sides of the comparison.
 */
const hashCode = (code: string) => createHash('sha256').update(code.replace(/\s|-/g, '').toUpperCase()).digest('hex');

/** Grouped for legibility when read aloud down a phone line. */
export function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = randomBytes(RECOVERY_CODE_BYTES).toString('hex').toUpperCase();
    return (raw.match(/.{1,5}/g) ?? [raw]).join('-');
  });
}

/**
 * Codes plus the digests to store, from one call.
 *
 * Exported because there were two independent implementations of this: the one
 * above, and a private copy in api/v1/auth/enroll-2fa/route.ts built on
 * `randomBytes(5)`. Forty bits, against an unsalted SHA-256, on the enrolment
 * path a platform owner is *most* likely to use — precisely the weakness the
 * RECOVERY_CODE_BYTES comment above describes as fixed. It was fixed here and
 * not there, because the copy was invisible from here.
 *
 * One function, three callers, one entropy figure to review.
 */
export function issueRecoveryCodes() {
  const codes = generateRecoveryCodes();
  return { codes, hashed: codes.map(hashCode) };
}

/**
 * The one place that legitimately loads the credential columns: every caller
 * below verifies a TOTP code, a recovery code or a password against them.
 * The returned object is never handed back to a caller as-is — each exported
 * function projects it — and lib/api/handler.ts scrubs the same keys on egress.
 */
async function platformUserFor(ctx: Ctx) {
  // Deliberately no `userId` parameter. It had one, defaulting to
  // `ctx.actor.id`, and not one of the five callers ever passed it.
  //
  // That is worth removing rather than leaving: `WorkspaceMembership` is in
  // GLOBAL_MODELS so the tenant guard is skipped, and it carries no row-level
  // security either — so this lookup is protected by neither of the two layers
  // everything else in the codebase relies on. `salesUserId` is globally unique,
  // so an id belonging to another workspace is a perfectly valid key here, and
  // what comes back is the row this file's own docstring calls the one place
  // that legitimately loads the credential columns.
  //
  // Nothing exploited it, because nothing passed the argument. An unused
  // parameter on a function like this is an invitation, and the next caller
  // would have had no reason to suspect it. Administering *another* user's
  // factors goes through `removeTotpFor`, which loads the target with
  // `prisma.user.findFirst({ where: { tenantId: ctx.tenantId, id } })` and takes
  // the platformUserId from that membership — the tenant-scoped way round.
  const membership = await prisma.workspaceMembership.findUnique({
    where: { salesUserId: ctx.actor.id },
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
 *
 * **Requires the account password**, for the same reason `changeOwnPassword`
 * does: a borrowed unlocked laptop is otherwise a permanent account takeover.
 * Enrolment is not a read — whoever completes it holds a factor on the account
 * and walks away with the recovery codes, which are the way back in when the
 * authenticator is lost. Without this, anyone holding a live session (or an API
 * key, which authenticates as the key's creator) could enrol *their own*
 * authenticator on somebody else's account, and the owner would have no way to
 * tell it apart from their own enrolment.
 *
 * The first-run flow in api/v1/auth/enroll-2fa is the deliberate exception: the
 * password was proven seconds earlier and its grant can reach nothing else.
 */
export async function beginTotpEnrolment(ctx: Ctx, currentPassword: string) {
  const user = await platformUserFor(ctx);
  if (user.mfaEnabled)
    throw Conflict('Two-factor authentication is already enabled. Disable it first if you want to re-enrol.');

  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, currentPassword))) {
    throw Forbidden('That password is not correct.');
  }

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
