import { NextResponse } from 'next/server';
import { isPrivilegedPlatformRole, isPlatformServiceRole } from '@/lib/auth/platform-policy';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { PlatformUser } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getNumericSetting } from '@/lib/platform-settings';
import { AppError, Unauthorized, TooManyRequests, Invalid } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { createPlatformSession, clientIp } from '@/lib/auth/session';
import { consume, limits } from '@/lib/security/ratelimit';
import { isActiveWorkspaceMembership } from '@/lib/auth/platform-policy';
import { readJsonBody } from '@/lib/api/read-body';
import { passwordPolicy } from '@/services/identity/accounts';
import { passwordExpired } from '@/services/identity/passwordHistory';
import {
  burnCredentialCheck,
  consumeMfaChallenge,
  createMfaChallenge,
  currentCredentialVersion,
  findLiveMfaChallenge,
  isPlatformStaff,
  matchCredential,
  recordMfaChallengeFailure,
  type CredentialPurpose,
} from '@/lib/auth/credentials';

/**
 * Two shapes, one endpoint.
 *
 *   { email, password }                       step one: a password
 *   { challenge, mfaCode | recoveryCode }     step two: the second factor
 *
 * and, for clients that send both at once, `{ email, password, mfaCode }`, which
 * runs step one and step two in the same request through the same challenge.
 *
 * There is no field that names a mode. Which of an identity's two passwords
 * verified is the only thing that decides whether the session administers the
 * platform or monitors it.
 */
const bodySchema = z
  .object({
    email: z.string().email().max(254).optional(),
    password: z.string().min(1).max(512).optional(),
    challenge: z.string().min(16).max(128).optional(),
    mfaCode: z.string().length(6).optional(),
    /** Used instead of mfaCode when the authenticator is unavailable. Single use. */
    recoveryCode: z.string().min(8).max(32).optional(),
  })
  .strict();

type Body = z.infer<typeof bodySchema>;

type RequestInfo = { requestId: string; ip: string; ua: string | null };

/**
 * Login is not routed through the API kernel: there is no Ctx to resolve yet and no
 * permission to assert. It therefore does its own rate limiting and auditing.
 *
 * Every failure path returns the same body and status and performs the same
 * hashing work — two Argon2id verifications, one per credential slot — so a caller
 * cannot distinguish unknown-email from wrong-password from locked-account, nor
 * tell which accounts hold a second password.
 */
export async function POST(req: Request) {
  const info: RequestInfo = {
    requestId: req.headers.get('x-request-id') ?? ulid(),
    ip: clientIp(req) ?? 'unknown',
    ua: req.headers.get('user-agent'),
  };

  try {
    const body = await readJsonBody(req, bodySchema);
    if (body.password !== undefined) {
      if (!body.email || body.challenge)
        throw Invalid([{ field: 'email', code: 'required', message: 'Enter your email.' }]);
      return await passwordStep(body as Body & { email: string; password: string }, info);
    }
    if (body.challenge) return await challengeStep(body.challenge, body, info);
    throw Invalid([{ field: 'password', code: 'required', message: 'Enter your password.' }]);
  } catch (err) {
    if (err instanceof AppError) {
      const headers: Record<string, string> = { 'x-request-id': info.requestId };
      if ((err as any).retryAfter) headers['retry-after'] = String((err as any).retryAfter);
      return NextResponse.json(err.toProblem(info.requestId), { status: err.status, headers });
    }
    logger.error({ err, requestId: info.requestId }, 'login failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId: info.requestId }, { status: 500 });
  }
}

/**
 * Both the account and the address buckets, for both steps.
 *
 * The second password shares them: an attempt against either slot is one
 * attempt, and so is each second-factor try. There is no allowance that exists
 * only because an identity has two credentials.
 */
async function throttle(ip: string, email: string) {
  try {
    await consume(limits.loginPerIp(ip));
    await consume(limits.loginPerAccount(email));
  } catch (limited) {
    // A throttled login must not read as wrong credentials: rethrow with a
    // message the form shows verbatim.
    const retryAfter = (limited as { retryAfter?: number }).retryAfter;
    const err: Error & { retryAfter?: number } = TooManyRequests(
      'Too many sign-in attempts. Wait a few minutes and try again.',
    );
    err.retryAfter = retryAfter;
    throw err;
  }
}

async function loadIdentity(normalizedEmail: string) {
  // `salesUser` is deliberately not joined here.
  //
  // Login is a bootstrap: no tenant is known yet, so this query runs with no
  // `app.tenant_id`. PlatformUser, WorkspaceMembership and Tenant are exempt
  // from RLS for exactly that reason, but `User` is not — joining it from here
  // returns null for every membership, which read as "no active workspace" and
  // rejected every login. The sales users are hydrated below, one tenant at a
  // time, where the context can be set.
  const user = await prisma.platformUser.findUnique({
    where: { normalizedEmail },
    include: {
      memberships: {
        where: { status: 'ACTIVE' },
        include: { tenant: true },
        orderBy: { joinedAt: 'asc' },
      },
    },
  });
  if (!user) return null;
  const memberships = (await hydrateSalesUsers(user.memberships)).filter(isActiveWorkspaceMembership);
  return { user, memberships };
}

type Identity = NonNullable<Awaited<ReturnType<typeof loadIdentity>>>;

/**
 * Whether an identity may sign in at all, before any credential is weighed.
 * Returns the failure reason, or null.
 */
function accountRefusal(identity: Identity | null, now: Date): string | null {
  if (!identity || identity.user.deletedAt || !identity.user.passwordHash) return 'UNKNOWN_ACCOUNT';
  const { user, memberships } = identity;
  if (user.lockedUntil && user.lockedUntil > now) return 'LOCKED';
  if (user.status !== 'ACTIVE') return 'INACTIVE';
  if (user.platformRole === 'USER' && memberships.length === 0) return 'NO_ACTIVE_WORKSPACE';
  return null;
}

async function passwordStep(body: Body & { email: string; password: string }, info: RequestInfo) {
  await throttle(info.ip, body.email);

  const now = new Date();
  const identity = await loadIdentity(body.email.trim().toLowerCase());
  const refusal = accountRefusal(identity, now);
  if (refusal) {
    await burnCredentialCheck();
    await recordFailure(null, identity && !identity.user.deletedAt ? identity.user.id : null, info, refusal);
    throw Unauthorized(GENERIC);
  }
  const { user, memberships } = identity!;
  const activeMembership = memberships[0] ?? null;

  const match = await matchCredential(user, body.password);

  if (match === 'AMBIGUOUS') {
    // Both slots accept this password — data no current path can write. Fail
    // closed, and say so where security reads rather than in the response.
    await securityEvent(user.id, info, 'LOGIN_CREDENTIAL_AMBIGUOUS', {
      reason: 'BOTH_CREDENTIALS_MATCH',
      platformRole: user.platformRole,
    });
    await recordFailure(null, user.id, info, 'AMBIGUOUS_CREDENTIAL');
    throw Unauthorized(GENERIC);
  }

  if (match === 'NONE') {
    const failures = user.failedLoginCount + 1;
    const locked = failures >= (await getNumericSetting('maxFailedLogins'));
    await prisma.platformUser.update({
      where: { id: user.id },
      data: {
        failedLoginCount: locked ? 0 : failures,
        lockedUntil: locked
          ? new Date(now.getTime() + (await getNumericSetting('lockoutMinutes')) * 60_000)
          : user.lockedUntil,
      },
    });
    await recordFailure(null, user.id, info, locked ? 'LOCKED_NOW' : 'BAD_PASSWORD');
    throw Unauthorized(GENERIC);
  }

  const staff = isPlatformStaff(user.platformRole);

  if (match === 'MONITORING' && !staff) {
    // A monitoring password on a workspace user or a machine identity. Only a
    // staff identity can be given one; anything else is a defect, refused.
    await securityEvent(user.id, info, 'LOGIN_CREDENTIAL_INELIGIBLE', {
      reason: 'MONITORING_CREDENTIAL_ON_NON_STAFF_IDENTITY',
      platformRole: user.platformRole,
    });
    await recordFailure(null, user.id, info, 'MONITORING_CREDENTIAL_INELIGIBLE');
    throw Unauthorized(GENERIC);
  }

  /**
   * A service identity proved its password at the wrong door.
   *
   * This route issues FULL sessions, and `resolvePlatformCtx` refuses an
   * AI_SERVICE identity holding one — so without this the account signs in
   * successfully, gets a session, and is silently bounced on its first request
   * with nothing to explain why. That is exactly what happened: correct
   * password, correct authenticator code, `LOGIN` recorded, and two sessions
   * revoked as ROLE_PURPOSE_MISMATCH seconds later.
   *
   * Placed *after* the password check on purpose. Answering before it would
   * tell an unauthenticated caller which accounts are service identities,
   * which is an enumeration oracle; here, whoever sees it has already proven
   * they hold the credential.
   *
   * No session is created, so there is nothing doomed to revoke.
   */
  if (isPlatformServiceRole(user.platformRole)) {
    await prisma.platformAuditEvent
      .create({
        data: {
          actorUserId: user.id,
          event: 'LOGIN_FAILED',
          objectType: 'platform_user',
          objectId: user.id,
          ipAddress: info.ip,
          userAgent: info.ua,
          requestId: info.requestId,
          metadata: { reason: 'SERVICE_IDENTITY_WRONG_ROUTE' },
        },
      })
      .catch(() => {});
    return NextResponse.json(
      {
        serviceIdentity: true,
        destination: '/service-login',
        detail:
          'This is a platform service identity. Sign in on the service page with its username instead of its email address.',
      },
      { status: 200, headers: { 'x-request-id': info.requestId } },
    );
  }

  // Fixed here, from the slot that matched, and never re-derived.
  const credentialPurpose: CredentialPurpose | null =
    match === 'MONITORING' ? 'MONITORING' : staff ? 'PLATFORM_ADMIN' : null;
  const credentialVersion = currentCredentialVersion(user, credentialPurpose);

  const settings = activeMembership
    ? await prisma.organizationSetting.findUnique({ where: { tenantId: activeMembership.tenantId } })
    : null;
  /**
   * Platform staff always need a second factor.
   *
   * Without this an owner with no authenticator would get a FULL session that
   * resolvePlatformCtx then refuses — locked out with no way to enrol, which
   * is the same trap mandatory workspace MFA used to be. Marking it required
   * here routes them to the enrolment grant instead.
   */
  const mfaRequired = user.mfaEnabled || settings?.mfaRequired === true || isPrivilegedPlatformRole(user.platformRole);

  if (credentialPurpose === 'MONITORING' && (!user.mfaEnabled || !user.mfaSecret)) {
    // The monitoring password never opens enrolment. A factor is enrolled with
    // the administration password; until then this password signs in nowhere.
    await recordFailure(null, user.id, info, 'MONITORING_REQUIRES_ENROLLED_MFA');
    throw Unauthorized(GENERIC);
  }

  // Policy demands a second factor and this account has none.
  //
  // The old code asked for a TOTP code anyway. There was no secret to generate
  // one from and no way to enrol, so switching `mfaRequired` on locked out
  // every user who had not already enrolled — permanently, with no path back.
  //
  // Issue a restricted grant instead: enough to reach /enroll-2fa and nothing
  // else. It is not a signed-in session — resolvePlatformCtx refuses it
  // everywhere except the enrolment, verification and logout endpoints.
  if (mfaRequired && !user.mfaSecret) {
    await prisma.platformUser.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    const grant = await createPlatformSession({
      platformUserId: user.id,
      activeTenantId: activeMembership?.tenantId ?? null,
      ip: info.ip,
      userAgent: info.ua,
      mfaSatisfied: false,
      purpose: 'MFA_ENROLMENT',
      credentialPurpose,
      credentialVersion: credentialPurpose ? credentialVersion : null,
    });
    await prisma.platformAuditEvent
      .create({
        data: {
          tenantId: activeMembership?.tenantId,
          actorUserId: user.id,
          event: 'LOGIN',
          objectType: 'platform_user',
          objectId: user.id,
          ipAddress: info.ip,
          userAgent: info.ua,
          requestId: info.requestId,
          metadata: { mfa: false, purpose: 'MFA_ENROLMENT', ...(credentialPurpose ? { credentialPurpose } : {}) },
        },
      })
      .catch(() => {});

    return NextResponse.json(
      {
        mfaEnrolmentRequired: true,
        destination: '/enroll-2fa',
        expiresAt: grant.expiresAt,
        detail: 'This workspace requires two-factor authentication. Set up an authenticator to continue.',
      },
      { status: 200, headers: { 'x-request-id': info.requestId } },
    );
  }

  if (!mfaRequired) {
    // A workspace user whose workspace does not require a second factor. Staff
    // never reach here: their role always requires one.
    await prisma.platformUser.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    return signedIn(identity!, null, credentialVersion, false, false, info);
  }

  /**
   * The password is right; the purpose it proved goes onto a server-held
   * challenge, and the MFA step reads it from there. The response carries an
   * opaque token and nothing about the mode.
   */
  const challenge = await createMfaChallenge({
    platformUserId: user.id,
    credentialPurpose,
    credentialVersion,
    ip: info.ip,
    userAgent: info.ua,
  });

  if (body.mfaCode || body.recoveryCode) {
    // Both factors in one request: complete the challenge just issued.
    return completeChallenge(challenge.id, body, info);
  }

  return NextResponse.json(
    { mfaRequired: true, challenge: challenge.token, challengeExpiresAt: challenge.expiresAt },
    { status: 200, headers: { 'x-request-id': info.requestId } },
  );
}

async function challengeStep(token: string, body: Body, info: RequestInfo) {
  const challenge = await findLiveMfaChallenge(token);
  if (!challenge) {
    // Unknown, spent or expired. Nothing about the account is revealed: the
    // caller already held the token, and the answer is the same for all three.
    await consume(limits.loginPerIp(info.ip)).catch(() => {});
    throw Unauthorized(EXPIRED);
  }
  const owner = await prisma.platformUser.findUnique({
    where: { id: challenge.platformUserId },
    select: { email: true },
  });
  await throttle(info.ip, owner?.email ?? challenge.platformUserId);
  return completeChallenge(challenge.id, body, info);
}

/**
 * The second factor, against a challenge, and — only if it verifies and the
 * identity still stands exactly as it did at the password step — a session
 * whose purpose is the challenge's.
 */
async function completeChallenge(challengeId: string, body: Body, info: RequestInfo) {
  const challenge = await prisma.platformMfaChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) throw Unauthorized(EXPIRED);

  const now = new Date();
  const fresh = await prisma.platformUser.findUnique({
    where: { id: challenge.platformUserId },
    select: { email: true },
  });
  const identity = fresh ? await loadIdentity(fresh.email.trim().toLowerCase()) : null;

  // Re-read, not remembered: a credential changed or revoked, a factor reset, an
  // account disabled or re-roled since the password step all end the challenge.
  const stale = identity ? challengeRefusal(challenge, identity.user) : 'IDENTITY_GONE';
  const refusal = accountRefusal(identity, now) ?? stale;
  if (refusal) {
    await consumeMfaChallenge(challenge.id);
    await recordFailure(null, challenge.platformUserId, info, `MFA_CHALLENGE_STALE:${refusal}`, {
      credentialPurpose: challenge.credentialPurpose,
    });
    throw Unauthorized(EXPIRED);
  }
  const { user, memberships } = identity!;
  const activeMembership = memberships[0] ?? null;

  if (!body.mfaCode && !body.recoveryCode) {
    throw Invalid([{ field: 'mfaCode', code: 'required', message: 'Enter the code from your authenticator.' }]);
  }

  const { verifyTotp } = await import('@/lib/auth/mfa');
  const { decryptSecret } = await import('@/services/identity/secrets');
  const { consumeRecoveryCode } = await import('@/services/identity/twoFactor');

  // The secret is stored encrypted; values enrolled before that change are
  // passed through unchanged by decryptSecret.
  const byTotp = Boolean(body.mfaCode && user.mfaSecret && verifyTotp(decryptSecret(user.mfaSecret), body.mfaCode));
  // A recovery code is spent here, so a captured one is worthless twice.
  const byRecovery = !byTotp && Boolean(body.recoveryCode) && (await consumeRecoveryCode(user.id, body.recoveryCode!));

  if (!byTotp && !byRecovery) {
    await recordMfaChallengeFailure(challenge.id);
    await recordFailure(activeMembership?.tenantId ?? null, user.id, info, 'BAD_MFA', {
      credentialPurpose: challenge.credentialPurpose,
    });
    throw Unauthorized(GENERIC);
  }

  // Exactly once, even if two requests race with the same token and a good code.
  if (!(await consumeMfaChallenge(challenge.id))) throw Unauthorized(EXPIRED);

  await prisma.platformUser.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });

  return signedIn(identity!, challenge.credentialPurpose, challenge.credentialVersion, true, byRecovery, info);
}

/**
 * Whether a challenge still describes the identity. Returns a reason, or null.
 *
 * The purpose must still be one this identity may hold, and the credential it
 * named must still be at the version the password verified against.
 */
function challengeRefusal(
  challenge: { credentialPurpose: CredentialPurpose | null; credentialVersion: number },
  user: PlatformUser,
): string | null {
  const staff = isPlatformStaff(user.platformRole);
  if (staff && !challenge.credentialPurpose) return 'ROLE_CHANGED';
  if (!staff && challenge.credentialPurpose) return 'ROLE_CHANGED';
  if (challenge.credentialPurpose === 'MONITORING') {
    if (!user.monitoringPasswordHash) return 'MONITORING_CREDENTIAL_REVOKED';
    if (!user.mfaEnabled || !user.mfaSecret) return 'MFA_RESET';
  }
  if (challenge.credentialVersion !== currentCredentialVersion(user, challenge.credentialPurpose)) {
    return 'CREDENTIAL_CHANGED';
  }
  if (!user.mfaSecret) return 'MFA_RESET';
  return null;
}

/** Creates the session and answers with where to go. */
async function signedIn(
  identity: Identity,
  credentialPurpose: CredentialPurpose | null,
  credentialVersion: number,
  mfaSatisfied: boolean,
  viaRecoveryCode: boolean,
  info: RequestInfo,
) {
  const { user, memberships } = identity;
  const monitoring = credentialPurpose === 'MONITORING';
  // A monitoring session opens no workspace by membership; it enters workspaces
  // through its grants, from /monitoring.
  const activeMembership = monitoring ? null : (memberships[0] ?? null);

  const session = await createPlatformSession({
    platformUserId: user.id,
    activeTenantId: activeMembership?.tenantId ?? null,
    ip: info.ip,
    userAgent: info.ua,
    mfaSatisfied,
    credentialPurpose,
    credentialVersion: credentialPurpose ? credentialVersion : null,
  });

  // Resolved against the workspace being entered. A platform owner with no
  // membership has no workspace policy to age out against, and the temporary
  // -password half of the predicate still applies to them. The monitoring
  // credential is never a temporary password.
  const mustChangePassword = monitoring
    ? false
    : activeMembership
      ? passwordExpired(user.passwordChangedAt, await passwordPolicy(activeMembership.tenantId))
      : user.passwordChangedAt === null;

  await prisma.platformAuditEvent.create({
    data: {
      tenantId: activeMembership?.tenantId,
      actorUserId: user.id,
      event: 'LOGIN',
      objectType: 'platform_user',
      objectId: user.id,
      ipAddress: info.ip,
      userAgent: info.ua,
      requestId: info.requestId,
      metadata: {
        mfa: mfaSatisfied,
        platformRole: user.platformRole,
        ...(credentialPurpose ? { credentialPurpose } : {}),
        ...(viaRecoveryCode ? { viaRecoveryCode: true } : {}),
      },
    },
  });

  return NextResponse.json(
    {
      user: { id: user.id, fullName: user.fullName, email: user.email, platformRole: user.platformRole },
      // Informational only. The server reads the mode from the session row.
      sessionMode: credentialPurpose,
      activeWorkspace: activeMembership
        ? {
            id: activeMembership.tenant.id,
            slug: activeMembership.tenant.slug,
            displayName: activeMembership.tenant.displayName,
          }
        : null,
      workspaces: monitoring
        ? []
        : memberships.map((membership) => ({
            id: membership.tenant.id,
            slug: membership.tenant.slug,
            displayName: membership.tenant.displayName,
            role: membership.salesUser?.role.key ?? membership.roleSnapshot,
          })),
      // Two reasons a password must be replaced before anything else opens,
      // through one predicate. Null `passwordChangedAt` is what an
      // administrator's reset leaves behind — the account is on a temporary
      // password. The other is the workspace's `maxAgeDays`, which was typed on
      // PasswordPolicy and read by nothing.
      mustChangePassword,
      destination: destinationFor(user.platformRole, credentialPurpose, activeMembership, mustChangePassword),
      expiresAt: session.expiresAt,
    },
    { headers: { 'x-request-id': info.requestId } },
  );
}

/**
 * Where a new session goes. Decided by the credential for staff, by membership
 * for everyone else.
 */
function destinationFor(
  platformRole: string,
  credentialPurpose: CredentialPurpose | null,
  activeMembership: { tenant: { slug: string } } | null,
  mustChangePassword: boolean,
): string {
  if (credentialPurpose === 'MONITORING') return '/monitoring';
  if (credentialPurpose === 'PLATFORM_ADMIN') return platformRole === 'OWNER' ? '/platform' : '/monitoring';
  if (mustChangePassword && activeMembership) return `/${activeMembership.tenant.slug}/profile/security`;
  if (activeMembership) return `/${activeMembership.tenant.slug}/dashboard`;
  return '/login';
}

const GENERIC = 'That email and password combination did not work.';
const EXPIRED = 'That sign-in has expired. Enter your email and password again.';

/**
 * Attaches each membership's workspace user, read per tenant.
 *
 * `User` is RLS-forced, so it can only be read once a tenant is named. Each
 * lookup below passes `tenantId` explicitly, which is what makes the tenant
 * guard set `app.tenant_id` for the query — see runPinned in lib/db.ts.
 */
async function hydrateSalesUsers<T extends { tenantId: string; salesUserId: string | null }>(memberships: T[]) {
  return Promise.all(
    memberships.map(async (membership) => {
      const salesUser = membership.salesUserId
        ? await prisma.user.findFirst({
            where: { tenantId: membership.tenantId, id: membership.salesUserId },
            select: { id: true, status: true, deletedAt: true, role: { select: { key: true } } },
          })
        : null;
      return { ...membership, salesUser };
    }),
  );
}

async function recordFailure(
  tenantId: string | null,
  userId: string | null,
  info: RequestInfo,
  reason: string,
  extra: Record<string, unknown> = {},
) {
  await prisma.platformAuditEvent
    .create({
      data: {
        tenantId,
        actorUserId: userId,
        event: 'LOGIN_FAILED',
        objectType: 'platform_user',
        objectId: userId,
        ipAddress: info.ip,
        userAgent: info.ua,
        requestId: info.requestId,
        metadata: { reason, ...extra },
      },
    })
    .catch(() => {});
}

/** A security-relevant anomaly: written for review, never shown to the caller. */
async function securityEvent(userId: string, info: RequestInfo, event: string, metadata: Record<string, unknown>) {
  logger.warn({ platformUserId: userId, event, ...metadata, requestId: info.requestId }, 'sign-in security event');
  await prisma.platformAuditEvent
    .create({
      data: {
        actorUserId: userId,
        event,
        objectType: 'platform_user',
        objectId: userId,
        ipAddress: info.ip,
        userAgent: info.ua,
        requestId: info.requestId,
        metadata,
      },
    })
    .catch(() => {});
}
