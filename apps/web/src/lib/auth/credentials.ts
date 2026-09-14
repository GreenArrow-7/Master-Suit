import { createHash, randomBytes } from 'node:crypto';
import type { PlatformCredentialPurpose } from '@prisma/client';
import { prisma } from '../db';
import { Conflict } from '../errors';
import { burnTiming, verifyOrBurn } from './password';
import { isSupportRole } from './support-actor';

/**
 * One platform identity, two passwords, and which one was proven.
 *
 * ── The model ─────────────────────────────────────────────────────────────────
 *
 * `PlatformUser.passwordHash` is the identity's primary password. For platform
 * staff (OWNER, SUPPORT, SECURITY_AUDITOR) it is the PLATFORM_ADMIN credential:
 * it confers what the identity's current role confers, and never more.
 *
 * `PlatformUser.monitoringPasswordHash` is an optional second password. It is
 * the MONITORING credential and always yields read-only monitoring of
 * explicitly authorised workspaces — whatever the role, whatever grants the
 * identity holds, even while a break-glass WRITE grant is live.
 *
 * The password decides. There is no mode selector, and nothing the client sends
 * — a field, a header, a cookie value — can name a mode. The purpose is fixed
 * the moment a password verifies, carried through the MFA step on a server-held
 * challenge, and written onto the session.
 *
 * Workspace users and machine identities have one credential and no purpose;
 * their sign-in is unchanged.
 */
export type CredentialPurpose = PlatformCredentialPurpose;

/** Which slot a password matched. */
export type CredentialMatch = 'PRIMARY' | 'MONITORING' | 'NONE' | 'AMBIGUOUS';

/** Platform staff: the identities whose sessions carry a credential purpose. */
export const isPlatformStaff = (platformRole: string) => isSupportRole(platformRole);

/**
 * Checks a password against both slots with the same work every time.
 *
 * Exactly two Argon2id verifications run for every attempt, whether or not the
 * identity has a second password — an empty slot is verified against a dummy
 * digest — so neither the result nor the timing says which accounts hold one.
 *
 * AMBIGUOUS is a data defect, not a guess: both slots accept the password. The
 * application refuses identical passwords when either is set, so this can only
 * come from something that wrote a hash without that check (an older release, a
 * script, a restore). The caller fails closed.
 */
export async function matchCredential(
  identity: { passwordHash: string | null; monitoringPasswordHash: string | null },
  plain: string,
): Promise<CredentialMatch> {
  const [primary, monitoring] = await Promise.all([
    verifyOrBurn(identity.passwordHash, plain),
    verifyOrBurn(identity.monitoringPasswordHash, plain),
  ]);
  if (primary && monitoring) return 'AMBIGUOUS';
  if (primary) return 'PRIMARY';
  if (monitoring) return 'MONITORING';
  return 'NONE';
}

/** The work `matchCredential` does, for paths that refuse before a password is checked. */
export const burnCredentialCheck = () => Promise.all([burnTiming(), burnTiming()]);

/** The current version of a credential, which sessions and challenges must match. */
export function currentCredentialVersion(
  identity: { passwordVersion: number; monitoringPasswordVersion: number },
  purpose: CredentialPurpose | null,
): number {
  return purpose === 'MONITORING' ? identity.monitoringPasswordVersion : identity.passwordVersion;
}

/**
 * Whether a session's recorded credential still stands, or why it does not.
 *
 * Asked on every request by `resolvePlatformCtx`, and by the refresh route before
 * it rotates anything. Returns a revocation reason, or null when the session is
 * sound.
 *
 * The mode is taken only from `credentialPurpose`, never inferred from the role.
 * The role decides only whether a purpose is *required*: platform staff must have
 * one, and a staff session without one is a legacy session that cannot say
 * which password proved it.
 */
export function credentialRefusal(
  session: { purpose: string; credentialPurpose: CredentialPurpose | null; credentialVersion: number | null },
  identity: {
    platformRole: string;
    passwordVersion: number;
    monitoringPasswordHash: string | null;
    monitoringPasswordVersion: number;
  },
): string | null {
  if (session.purpose === 'AI_SERVICE') return null;

  if (!isPlatformStaff(identity.platformRole)) {
    // A purpose on a non-staff session means the role changed under a live
    // session. Role changes revoke sessions; this is the backstop.
    return session.credentialPurpose ? 'CREDENTIAL_PURPOSE_ROLE_MISMATCH' : null;
  }

  if (!session.credentialPurpose) return 'LEGACY_SESSION_WITHOUT_CREDENTIAL_PURPOSE';

  if (session.credentialPurpose === 'MONITORING') {
    // The monitoring password is never a way to enrol a factor: it can only be
    // set on an identity that already has one.
    if (session.purpose !== 'FULL') return 'MONITORING_SESSION_PURPOSE_INVALID';
    if (!identity.monitoringPasswordHash) return 'MONITORING_CREDENTIAL_REVOKED';
  }

  if (session.credentialVersion !== currentCredentialVersion(identity, session.credentialPurpose)) {
    return 'CREDENTIAL_CHANGED';
  }
  return null;
}

/**
 * Refuses a password that the identity's other credential already accepts.
 *
 * Needs the plaintext: Argon2id digests are salted, so two hashes of the same
 * password never compare equal. `target` is the credential being written.
 */
export async function assertDistinctFromOtherCredential(
  identity: { passwordHash: string | null; monitoringPasswordHash: string | null },
  plain: string,
  target: CredentialPurpose,
) {
  const other = target === 'MONITORING' ? identity.passwordHash : identity.monitoringPasswordHash;
  if (other && (await verifyOrBurn(other, plain))) {
    throw Conflict(
      target === 'MONITORING'
        ? 'The monitoring password must be different from your administration password.'
        : 'This password is already your monitoring password. The two must be different.',
    );
  }
}

// ── MFA challenges ───────────────────────────────────────────────────────────

/** Minutes between a verified password and its second factor. */
export const MFA_CHALLENGE_TTL_MINUTES = 5;
/** Wrong codes a single challenge absorbs before it is spent. */
export const MFA_CHALLENGE_MAX_ATTEMPTS = 5;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export async function createMfaChallenge(input: {
  platformUserId: string;
  credentialPurpose: CredentialPurpose | null;
  credentialVersion: number;
  ip: string | null;
  userAgent: string | null;
}) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MINUTES * 60_000);
  const row = await prisma.platformMfaChallenge.create({
    data: {
      platformUserId: input.platformUserId,
      tokenHash: sha256(token),
      credentialPurpose: input.credentialPurpose,
      credentialVersion: input.credentialVersion,
      expiresAt,
      ipAddress: input.ip,
      userAgent: input.userAgent,
    },
  });
  return { token, id: row.id, expiresAt };
}

/** A live challenge by its token, or null when it is unknown, spent or expired. */
export async function findLiveMfaChallenge(token: string) {
  const row = await prisma.platformMfaChallenge.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.consumedAt || row.expiresAt < new Date() || row.attempts >= MFA_CHALLENGE_MAX_ATTEMPTS) return null;
  return row;
}

/** Counts a wrong code. The challenge is spent once the limit is reached. */
export async function recordMfaChallengeFailure(id: string) {
  const updated = await prisma.platformMfaChallenge.update({
    where: { id },
    data: { attempts: { increment: 1 } },
    select: { attempts: true },
  });
  if (updated.attempts >= MFA_CHALLENGE_MAX_ATTEMPTS) {
    await prisma.platformMfaChallenge.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
  }
}

/**
 * Spends a challenge exactly once.
 *
 * Conditional on it still being unspent, so two requests racing with the same
 * token and a valid code cannot both produce a session.
 */
export async function consumeMfaChallenge(id: string): Promise<boolean> {
  const { count } = await prisma.platformMfaChallenge.updateMany({
    where: { id, consumedAt: null, attempts: { lt: MFA_CHALLENGE_MAX_ATTEMPTS } },
    data: { consumedAt: new Date() },
  });
  return count === 1;
}

/**
 * Ends unfinished sign-ins for an identity.
 *
 * With a purpose, only challenges issued for that credential; without one, all
 * of them. Called when a credential changes or is revoked, when MFA is reset,
 * and when the account is disabled, demoted or deleted. Completion re-reads the
 * identity as well, so this is the explicit half of a check that also holds on
 * its own.
 */
export async function invalidateMfaChallenges(platformUserId: string, purpose?: CredentialPurpose) {
  const { count } = await prisma.platformMfaChallenge.deleteMany({
    where: { platformUserId, consumedAt: null, ...(purpose ? { credentialPurpose: purpose } : {}) },
  });
  return count;
}

/** Revokes the live sessions one credential produced. */
export async function revokeSessionsForCredential(platformUserId: string, purpose: CredentialPurpose, reason: string) {
  const { count } = await prisma.platformSession.updateMany({
    where: { platformUserId, credentialPurpose: purpose, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return count;
}
