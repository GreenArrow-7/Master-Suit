import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError, Forbidden, TooManyRequests, Unauthorized } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { burnTiming, verifyPassword } from '@/lib/auth/password';
import { clientIp, createPlatformSession } from '@/lib/auth/session';
import { isPlatformServiceRole } from '@/lib/auth/platform-policy';
import { consume, limits } from '@/lib/security/ratelimit';
import { readJsonBody } from '@/lib/api/read-body';
import { verifyTotp } from '@/lib/auth/mfa';
import { decryptSecret } from '@/services/identity/secrets';
import { consumeRecoveryCode } from '@/services/identity/twoFactor';
import { assertSameOrigin } from '@/lib/security/origin';

/**
 * Interactive sign-in for an `AI_SERVICE` identity:
 * **username → password → MFA → an AI_SERVICE platform session.**
 *
 * ── Why this is a separate route ────────────────────────────────────────────
 *
 * `resolvePlatformCtx` used to refuse every session belonging to a machine
 * identity. That protection is not removed — it is narrowed to "refuse any
 * session this route did not mint", enforced through `PlatformSession.purpose`.
 * The human login route still cannot produce one: it issues FULL sessions, and a
 * machine identity holding a FULL session is now an explicit, logged refusal.
 *
 * Keeping it out of api/v1/auth/login is also the smaller blast radius. That
 * route is the most security-critical in the application and serves every
 * customer; the alternative was threading a second identifier and a second set
 * of role rules through it for the benefit of one account.
 *
 * ── What is reused rather than rebuilt ──────────────────────────────────────
 *
 * Every primitive: `verifyPassword` (Argon2id) and `burnTiming` for the constant
 * -work failure path, `consume`/`limits` for throttling, `env.MAX_FAILED_LOGINS`
 * and `env.LOCKOUT_MINUTES` for lockout, `verifyTotp` against the envelope
 * -encrypted secret, `consumeRecoveryCode` for single-use recovery codes, and
 * `createPlatformSession` for the cookie. No new cryptography exists here.
 *
 * ── MFA cannot be skipped ───────────────────────────────────────────────────
 *
 * There is no branch that issues a usable session without a second factor. An
 * identity with no enrolled authenticator gets an MFA_ENROLMENT grant, which
 * reaches the enrolment endpoint and nothing else — the same mechanism that
 * stops mandatory 2FA locking out a human who has not enrolled yet.
 */
const bodySchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(1).max(512),
  mfaCode: z.string().length(6).optional(),
  recoveryCode: z.string().min(8).max(32).optional(),
});

/** One message for every failure, so nothing here is an account oracle. */
const GENERIC = 'That username and password combination did not work.';

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  const ip = clientIp(req) ?? 'unknown';
  const ua = req.headers.get('user-agent');

  try {
    // Browser-borne credential, so a cross-site POST must not be able to drive
    // it. See lib/security/origin.ts for what this does and does not cover.
    assertSameOrigin(req);

    const body = await readJsonBody(req, bodySchema);
    const username = body.username.trim().toLowerCase();

    try {
      await consume(limits.loginPerIp(ip));
      await consume(limits.serviceLogin(username));
    } catch (limited) {
      const err: Error & { retryAfter?: number } = TooManyRequests(
        'Too many sign-in attempts for this service account. Wait and try again.',
      );
      err.retryAfter = (limited as { retryAfter?: number }).retryAfter;
      throw err;
    }

    const user = await prisma.platformUser.findUnique({ where: { username } });
    const now = new Date();

    // Unknown username, no password set, or deleted — all answered identically,
    // and all after the same Argon2 work a real verification would cost.
    if (!user || user.deletedAt || !user.passwordHash) {
      await burnTiming();
      await recordFailure(null, ip, ua, requestId, 'UNKNOWN_ACCOUNT', username);
      throw Unauthorized(GENERIC);
    }

    /**
     * This route signs in service identities and nothing else.
     *
     * Without it, giving any platform account a username would quietly open a
     * second sign-in path to it — one that skips the human route's workspace
     * checks. An OWNER must keep arriving through api/v1/auth/login.
     */
    if (!isPlatformServiceRole(user.platformRole)) {
      await burnTiming();
      await recordFailure(user.id, ip, ua, requestId, 'NOT_A_SERVICE_IDENTITY', username);
      throw Unauthorized(GENERIC);
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      await burnTiming();
      await recordFailure(user.id, ip, ua, requestId, 'LOCKED', username);
      throw Unauthorized(GENERIC);
    }

    if (user.status !== 'ACTIVE') {
      await burnTiming();
      await recordFailure(user.id, ip, ua, requestId, 'INACTIVE', username);
      throw Unauthorized(GENERIC);
    }

    if (!(await verifyPassword(user.passwordHash, body.password))) {
      const failures = user.failedLoginCount + 1;
      const locked = failures >= env.MAX_FAILED_LOGINS;
      await prisma.platformUser.update({
        where: { id: user.id },
        data: {
          failedLoginCount: locked ? 0 : failures,
          lockedUntil: locked ? new Date(now.getTime() + env.LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
        },
      });
      await recordFailure(user.id, ip, ua, requestId, locked ? 'LOCKED_NOW' : 'BAD_PASSWORD', username, {
        attempt: failures,
      });
      if (locked) await record(user.id, 'ACCOUNT_LOCKED', ip, ua, requestId, { after: failures });
      throw Unauthorized(GENERIC);
    }

    /**
     * No authenticator yet: hand back the restricted enrolment grant.
     *
     * This is the one path that produces a session without a second factor, and
     * it is not a bypass — `resolvePlatformCtx` refuses an MFA_ENROLMENT grant
     * everywhere except the enrolment, verification and logout endpoints. It is
     * how the account gets its first factor at all; without it, mandating MFA on
     * an identity that has never enrolled locks it out permanently.
     */
    if (!user.mfaSecret || !user.mfaEnabled) {
      await prisma.platformUser.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
      });
      const grant = await createPlatformSession({
        platformUserId: user.id,
        activeTenantId: null,
        ip,
        userAgent: ua,
        mfaSatisfied: false,
        purpose: 'MFA_ENROLMENT',
      });
      await record(user.id, 'LOGIN', ip, ua, requestId, { mfa: false, purpose: 'MFA_ENROLMENT' });
      return NextResponse.json(
        {
          mfaEnrolmentRequired: true,
          destination: '/enroll-2fa',
          expiresAt: grant.expiresAt,
          detail:
            'This service account has no authenticator yet. Enrol one to continue — the QR code and recovery codes are issued there.',
        },
        { headers: { 'x-request-id': requestId } },
      );
    }

    // Password proved, factor exists, none offered: ask for it. No session is
    // created here, so an unverified session never exists at any point.
    if (!body.mfaCode && !body.recoveryCode) {
      return NextResponse.json({ mfaRequired: true }, { headers: { 'x-request-id': requestId } });
    }

    // Brute-forcing six digits must not be free even with a correct password.
    await consume(limits.mfaConfirm(user.id));

    const byTotp = Boolean(body.mfaCode && verifyTotp(decryptSecret(user.mfaSecret), body.mfaCode));
    const byRecovery = !byTotp && Boolean(body.recoveryCode) && (await consumeRecoveryCode(user.id, body.recoveryCode!));

    if (!byTotp && !byRecovery) {
      /**
       * A failed second factor counts toward lockout.
       *
       * The human login route does not do this, and for that account it is
       * arguable — a person fumbling a code is common. Here the password has
       * already been proven, so a wrong code means either a broken clock or
       * somebody holding the password and working on the factor. Neither should
       * get unlimited attempts.
       */
      const failures = user.failedLoginCount + 1;
      const locked = failures >= env.MAX_FAILED_LOGINS;
      await prisma.platformUser.update({
        where: { id: user.id },
        data: {
          failedLoginCount: locked ? 0 : failures,
          lockedUntil: locked ? new Date(now.getTime() + env.LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
        },
      });
      await recordFailure(user.id, ip, ua, requestId, locked ? 'LOCKED_NOW_BAD_MFA' : 'BAD_MFA', username);
      if (locked) await record(user.id, 'ACCOUNT_LOCKED', ip, ua, requestId, { after: failures, cause: 'mfa' });
      throw Unauthorized(GENERIC);
    }

    await prisma.platformUser.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });

    const session = await createPlatformSession({
      platformUserId: user.id,
      activeTenantId: null,
      ip,
      userAgent: ua,
      mfaSatisfied: true,
      purpose: 'AI_SERVICE',
    });

    await record(user.id, 'LOGIN', ip, ua, requestId, {
      mfa: true,
      viaRecoveryCode: byRecovery,
      platformRole: user.platformRole,
      purpose: 'AI_SERVICE',
      // What this session may actually do, recorded at the moment it is issued,
      // so the log answers "what could it see" without a second lookup against
      // values that may have changed since.
      scopes: user.serviceScopes,
      workspaces: user.serviceTenantAllowlist.length ? user.serviceTenantAllowlist : 'all',
    });

    return NextResponse.json(
      {
        identity: { id: user.id, username: user.username, platformRole: user.platformRole },
        readOnly: true,
        scopes: user.serviceScopes,
        workspaces: user.serviceTenantAllowlist.length ? user.serviceTenantAllowlist : 'all',
        recoveryCodeUsed: byRecovery,
        expiresAt: session.expiresAt,
        detail:
          'Signed in as a platform service identity. This session is read-only and cannot be elevated.',
      },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    if (err instanceof AppError) {
      const headers: Record<string, string> = { 'x-request-id': requestId };
      const retryAfter = (err as { retryAfter?: number }).retryAfter;
      if (retryAfter) headers['retry-after'] = String(retryAfter);
      return NextResponse.json(err.toProblem(requestId), { status: err.status, headers });
    }
    logger.error({ err, requestId }, 'service login failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}

/**
 * Ends the session that made the request, and optionally every other one.
 *
 * The `all` form is the credential-compromise path: one call and every browser
 * holding this identity is signed out.
 */
export async function DELETE(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    assertSameOrigin(req);
    const { resolvePlatformCtx } = await import('@/lib/auth/session');
    const ctx = await resolvePlatformCtx(req, requestId, ['AI_SERVICE', 'MFA_ENROLMENT']);
    if (!isPlatformServiceRole(ctx.platformRole)) throw Forbidden('Not a service identity session.');

    const all = new URL(req.url).searchParams.get('all') === 'true';
    const { revokeAllPlatformSessions } = await import('@/lib/auth/session');
    const revoked = all
      ? await revokeAllPlatformSessions(ctx.platformUserId, 'LOGOUT_ALL')
      : await revokeAllPlatformSessions(ctx.platformUserId, 'LOGOUT').then(() => 1);

    await record(ctx.platformUserId, 'LOGOUT', ctx.ip, ctx.userAgent, requestId, { all, revoked });
    return NextResponse.json({ signedOut: true, sessionsRevoked: revoked }, { headers: { 'x-request-id': requestId } });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(err.toProblem(requestId), {
        status: err.status,
        headers: { 'x-request-id': requestId },
      });
    }
    logger.error({ err, requestId }, 'service logout failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}

/**
 * One audit row per authentication event, in the protected platform log.
 *
 * `tenantId` is null throughout: signing in is not an act inside any customer's
 * workspace, so attaching one would put a platform authentication event into a
 * tenant's audit timeline where it does not belong. What the session goes on to
 * *read* is audited per request against the workspace it reads — that is
 * lib/auth/service-identity.ts's job, not this one's.
 *
 * Nothing here carries a password, a TOTP secret, a recovery code or a session
 * token, and the metadata below is a closed set of literals for that reason —
 * an audit writer that forwards whatever it is handed is how secrets reach logs.
 */
async function record(
  platformUserId: string | null,
  event: string,
  ip: string | null,
  ua: string | null,
  requestId: string,
  metadata: Record<string, unknown>,
) {
  await prisma.platformAuditEvent
    .create({
      data: {
        tenantId: null,
        actorUserId: platformUserId,
        event,
        objectType: 'platform_service_identity',
        objectId: platformUserId,
        ipAddress: ip,
        userAgent: ua,
        requestId,
        metadata: metadata as never,
      },
    })
    .catch((err) => logger.error({ err, requestId, event }, 'service auth audit write failed'));
}

function recordFailure(
  platformUserId: string | null,
  ip: string,
  ua: string | null,
  requestId: string,
  reason: string,
  username: string,
  extra: Record<string, unknown> = {},
) {
  // The username is recorded even when no account matched: "somebody is trying
  // usernames" is the question this log has to be able to answer. It is an
  // identifier, not a credential.
  return record(platformUserId, 'LOGIN_FAILED', ip, ua, requestId, { reason, username, ...extra });
}
