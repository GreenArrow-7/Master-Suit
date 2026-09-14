import { prisma, withPlatformTx } from '@/lib/db';
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { checkPolicy, DEFAULT_POLICY, hashPassword, verifyPassword } from '@/lib/auth/password';
import { verifyTotp } from '@/lib/auth/mfa';
import { consume, limits } from '@/lib/security/ratelimit';
import { isPlatformServiceRole } from '@/lib/auth/platform-policy';
import {
  assertDistinctFromOtherCredential,
  invalidateMfaChallenges,
  isPlatformStaff,
  revokeSessionsForCredential,
  type CredentialPurpose,
} from '@/lib/auth/credentials';
import { decryptSecret } from '@/services/identity/secrets';
import { assertNotReused, recordPreviousPassword } from '@/services/identity/passwordHistory';

/**
 * The credential lifecycle for platform staff: setting, changing and revoking the
 * monitoring password, and changing the administration password.
 *
 * ── Who may do what ─────────────────────────────────────────────────────────
 *
 * Self-service, for the signed-in identity only, and only from an
 * administration session — the route checks that before calling here. Every
 * operation re-authenticates first: the current administration password *and* a
 * fresh authenticator code, in the same request. A borrowed unlocked laptop with
 * a live session is not enough to set or read anything. A monitoring session
 * manages neither credential, and an enrolment-only session is not a session.
 *
 * The one cross-identity operation is revocation by another platform owner
 * (`revokeMonitoringCredentialFor`), which can only remove access. Nobody sets
 * another person's monitoring password, and nothing sets one by default.
 *
 * ── What each change ends ───────────────────────────────────────────────────
 *
 * Changing or revoking the monitoring password bumps its version, revokes the
 * sessions it produced and deletes its unfinished MFA challenges. The
 * administration password and its sessions are untouched, so monitoring access
 * can be withdrawn without changing it.
 *
 * Changing the administration password follows the established rule for a
 * password change — every session for the identity is revoked, both modes — and
 * ends every unfinished challenge.
 */

export interface CredentialActor {
  platformUserId: string;
  sessionId: string;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

const IDENTITY = {
  id: true,
  email: true,
  status: true,
  deletedAt: true,
  platformRole: true,
  passwordHash: true,
  passwordVersion: true,
  monitoringPasswordHash: true,
  monitoringPasswordVersion: true,
  monitoringPasswordSetAt: true,
  mfaEnabled: true,
  mfaSecret: true,
} as const;

async function loadStaffIdentity(platformUserId: string) {
  const identity = await prisma.platformUser.findUnique({ where: { id: platformUserId }, select: IDENTITY });
  if (!identity || identity.deletedAt || identity.status !== 'ACTIVE') throw NotFound('Platform identity');
  return identity;
}

type StaffIdentity = Awaited<ReturnType<typeof loadStaffIdentity>>;

/**
 * Proves the person at the keyboard is the account holder, now.
 *
 * Both factors, both required, verified against the administration credential
 * only — the monitoring password never re-authenticates anything. Throttled on
 * the same per-identity bucket as enrolment confirmation, and a failure is
 * recorded without saying which half failed.
 */
export async function reauthenticate(
  identity: StaffIdentity,
  actor: CredentialActor,
  proof: { currentPassword: string; mfaCode: string },
  operation: string,
) {
  await consume(limits.mfaConfirm(identity.id));
  const passwordOk =
    Boolean(identity.passwordHash) && (await verifyPassword(identity.passwordHash!, proof.currentPassword));
  const codeOk =
    identity.mfaEnabled && Boolean(identity.mfaSecret) && verifyTotp(decryptSecret(identity.mfaSecret!), proof.mfaCode);
  if (!passwordOk || !codeOk) {
    await record(prisma, actor, 'CREDENTIAL_REAUTHENTICATION_FAILED', identity, { operation });
    throw Forbidden('Re-authentication failed. Enter your administration password and a current code.');
  }
}

/** What the credential page shows. Never a hash. */
export async function credentialStatus(platformUserId: string) {
  const identity = await loadStaffIdentity(platformUserId);
  return {
    platformRole: identity.platformRole,
    eligibleForMonitoringCredential: monitoringEligibility(identity) === null,
    ineligibleReason: monitoringEligibility(identity),
    hasMonitoringCredential: identity.monitoringPasswordHash !== null,
    monitoringCredentialSetAt: identity.monitoringPasswordSetAt,
    mfaEnabled: identity.mfaEnabled,
  };
}

/** Null when this identity may hold a monitoring password, otherwise why not. */
function monitoringEligibility(identity: StaffIdentity): string | null {
  if (isPlatformServiceRole(identity.platformRole)) return 'A service identity cannot hold a monitoring password.';
  if (!isPlatformStaff(identity.platformRole)) return 'Only platform staff can hold a monitoring password.';
  if (!identity.mfaEnabled || !identity.mfaSecret) return 'Set up two-factor authentication first.';
  return null;
}

function assertStrong(password: string, field: string) {
  const problems = checkPolicy(password, DEFAULT_POLICY);
  if (problems.length) throw Invalid(problems.map((message) => ({ field, code: 'weak-password', message })));
}

/** Sets, or replaces, the signed-in identity's monitoring password. */
export async function setOwnMonitoringCredential(
  actor: CredentialActor,
  input: { currentPassword: string; mfaCode: string; newPassword: string },
) {
  const identity = await loadStaffIdentity(actor.platformUserId);
  const ineligible = monitoringEligibility(identity);
  if (ineligible) throw Forbidden(ineligible);
  await reauthenticate(identity, actor, input, 'set-monitoring-credential');

  assertStrong(input.newPassword, 'newPassword');
  await assertDistinctFromOtherCredential(identity, input.newPassword, 'MONITORING');
  if (identity.monitoringPasswordHash && (await verifyPassword(identity.monitoringPasswordHash, input.newPassword))) {
    throw Conflict('That is already your monitoring password. Choose a different one.');
  }

  const replacing = identity.monitoringPasswordHash !== null;
  const hash = await hashPassword(input.newPassword);
  // The credential, the sessions it ends and the audit row commit together.
  const revokedSessions = await withPlatformTx(async (tx) => {
    const updated = await tx.platformUser.update({
      where: { id: identity.id },
      data: {
        monitoringPasswordHash: hash,
        monitoringPasswordVersion: { increment: 1 },
        monitoringPasswordSetAt: new Date(),
      },
      select: { monitoringPasswordVersion: true },
    });
    const ended = await endMonitoringAccess(tx, identity.id, 'MONITORING_CREDENTIAL_CHANGED');
    await record(tx, actor, replacing ? 'MONITORING_CREDENTIAL_CHANGED' : 'MONITORING_CREDENTIAL_SET', identity, {
      credentialPurpose: 'MONITORING',
      version: updated.monitoringPasswordVersion,
      ...ended,
      by: 'self',
    });
    return ended.revokedSessions;
  });
  return { hasMonitoringCredential: true, replaced: replacing, revokedSessions };
}

/** Removes the signed-in identity's monitoring password. The administration password is untouched. */
export async function revokeOwnMonitoringCredential(
  actor: CredentialActor,
  input: { currentPassword: string; mfaCode: string },
) {
  const identity = await loadStaffIdentity(actor.platformUserId);
  await reauthenticate(identity, actor, input, 'revoke-monitoring-credential');
  return clearMonitoringCredential(identity, actor, 'self');
}

/**
 * Another platform owner withdraws someone's monitoring password.
 *
 * Only removes access, so it needs the acting owner's own second factor rather
 * than the target's anything. Refused for the actor's own identity: that goes
 * through self-service, which demands the password as well.
 */
export async function revokeMonitoringCredentialFor(
  actor: CredentialActor,
  targetId: string,
  input: { mfaCode: string },
) {
  if (targetId === actor.platformUserId) {
    throw Conflict('Revoke your own monitoring password from your security page.');
  }
  const owner = await loadStaffIdentity(actor.platformUserId);
  await consume(limits.mfaConfirm(owner.id));
  if (!owner.mfaEnabled || !owner.mfaSecret || !verifyTotp(decryptSecret(owner.mfaSecret), input.mfaCode)) {
    await record(prisma, actor, 'CREDENTIAL_REAUTHENTICATION_FAILED', owner, {
      operation: 'revoke-monitoring-credential-for',
      target: targetId,
    });
    throw Forbidden('Re-authentication failed. Enter a current code from your authenticator.');
  }
  const target = await prisma.platformUser.findUnique({ where: { id: targetId }, select: IDENTITY });
  if (!target || target.deletedAt) throw NotFound('Platform identity');
  return clearMonitoringCredential(target, actor, 'platform-owner');
}

async function clearMonitoringCredential(identity: StaffIdentity, actor: CredentialActor, by: string) {
  if (!identity.monitoringPasswordHash) throw Conflict('There is no monitoring password to revoke.');
  const revokedSessions = await withPlatformTx(async (tx) => {
    const updated = await tx.platformUser.update({
      where: { id: identity.id },
      data: {
        monitoringPasswordHash: null,
        monitoringPasswordVersion: { increment: 1 },
        monitoringPasswordSetAt: null,
      },
      select: { monitoringPasswordVersion: true },
    });
    const ended = await endMonitoringAccess(tx, identity.id, 'MONITORING_CREDENTIAL_REVOKED');
    await record(tx, actor, 'MONITORING_CREDENTIAL_REVOKED', identity, {
      credentialPurpose: 'MONITORING',
      version: updated.monitoringPasswordVersion,
      ...ended,
      by,
    });
    return ended.revokedSessions;
  });
  return { hasMonitoringCredential: false, revokedSessions };
}

type Tx = Parameters<Parameters<typeof withPlatformTx>[0]>[0];

/** Revokes the monitoring password's sessions and deletes its unfinished challenges. */
async function endMonitoringAccess(tx: Tx, platformUserId: string, reason: string) {
  const sessions = await tx.platformSession.updateMany({
    where: { platformUserId, credentialPurpose: 'MONITORING', revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  const challenges = await tx.platformMfaChallenge.deleteMany({
    where: { platformUserId, credentialPurpose: 'MONITORING', consumedAt: null },
  });
  return { revokedSessions: sessions.count, cancelledChallenges: challenges.count };
}

/**
 * Removes a monitoring password as a side effect of something else — a demotion
 * out of platform staff, an account deletion — without re-authentication, because
 * the caller has already authorised the larger change. Silent when there is none.
 */
export async function dropMonitoringCredential(platformUserId: string, reason: string) {
  const { count } = await prisma.platformUser.updateMany({
    where: { id: platformUserId, monitoringPasswordHash: { not: null } },
    data: { monitoringPasswordHash: null, monitoringPasswordVersion: { increment: 1 }, monitoringPasswordSetAt: null },
  });
  if (count === 0) return false;
  await revokeSessionsForCredential(platformUserId, 'MONITORING', reason);
  await invalidateMfaChallenges(platformUserId, 'MONITORING');
  return true;
}

/** Changes the signed-in identity's administration password. Signs out every session. */
export async function changeOwnAdministrationPassword(
  actor: CredentialActor,
  input: { currentPassword: string; mfaCode: string; newPassword: string },
) {
  const identity = await loadStaffIdentity(actor.platformUserId);
  if (!isPlatformStaff(identity.platformRole)) throw Forbidden('Only platform staff use this page.');
  await reauthenticate(identity, actor, input, 'change-administration-password');

  if (input.newPassword === input.currentPassword) {
    throw Conflict('The new password must be different from the current one.');
  }
  assertStrong(input.newPassword, 'newPassword');
  await assertNotReused(identity.id, input.newPassword, DEFAULT_POLICY);
  await writePrimaryPassword(identity.id, input.newPassword, { passwordChangedAt: new Date() });
  await recordPreviousPassword(identity.id, identity.passwordHash);

  await withPlatformTx(async (tx) => {
    const revoked = await tx.platformSession.updateMany({
      where: { platformUserId: identity.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' },
    });
    await record(tx, actor, 'PASSWORD_CHANGED', identity, {
      credentialPurpose: 'PLATFORM_ADMIN',
      revokedSessions: revoked.count,
      by: 'self',
    });
  });
  return { changed: true, signedOut: true };
}

/**
 * The single writer of `PlatformUser.passwordHash` for application code.
 *
 * Refuses a password the monitoring credential already accepts, stores a fresh
 * salted hash, increments the version — which ends every administration session
 * and challenge derived from the old one on their next use — and deletes the
 * unfinished challenges outright. Session revocation stays with the caller,
 * because callers differ in which sessions a change ends.
 */
export async function writePrimaryPassword(
  platformUserId: string,
  plain: string,
  options: { passwordChangedAt: Date | null },
): Promise<void> {
  const identity = await prisma.platformUser.findUnique({
    where: { id: platformUserId },
    select: { passwordHash: true, monitoringPasswordHash: true },
  });
  if (!identity) throw NotFound('Platform identity');
  await assertDistinctFromOtherCredential(identity, plain, 'PLATFORM_ADMIN');
  const passwordHash = await hashPassword(plain);
  await withPlatformTx(async (tx) => {
    await tx.platformUser.update({
      where: { id: platformUserId },
      data: {
        passwordHash,
        passwordVersion: { increment: 1 },
        passwordChangedAt: options.passwordChangedAt,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await tx.platformMfaChallenge.deleteMany({ where: { platformUserId, consumedAt: null } });
  });
}

async function record(
  db: Pick<Tx, 'platformAuditEvent'>,
  actor: CredentialActor,
  event: string,
  target: { id: string; email: string },
  metadata: Record<string, unknown>,
) {
  // No password, hash, code or secret is ever part of `metadata`.
  await db.platformAuditEvent
    .create({
      data: {
        actorUserId: actor.platformUserId,
        event,
        objectType: 'platform_user',
        objectId: target.id,
        requestId: actor.requestId,
        ipAddress: actor.ip,
        userAgent: actor.userAgent,
        metadata: { target: target.email, ...metadata },
      },
    })
    .catch((err) => {
      logger.error({ err, event, requestId: actor.requestId }, 'credential audit write failed');
      throw err;
    });
}

export type { CredentialPurpose };
