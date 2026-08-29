import { NextResponse } from 'next/server';
import { isPrivilegedPlatformRole, isPlatformServiceRole } from '@/lib/auth/platform-policy';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getNumericSetting } from '@/lib/platform-settings';
import { AppError, Unauthorized, TooManyRequests } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { verifyPassword, burnTiming } from '@/lib/auth/password';
import { createPlatformSession, clientIp } from '@/lib/auth/session';
import { consume, limits } from '@/lib/security/ratelimit';
import { isActiveWorkspaceMembership } from '@/lib/auth/platform-policy';
import { readJsonBody } from '@/lib/api/read-body';
import { passwordPolicy } from '@/services/identity/accounts';
import { passwordExpired } from '@/services/identity/passwordHistory';

const bodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(512),
  mfaCode: z.string().length(6).optional(),
  /** Used instead of mfaCode when the authenticator is unavailable. Single use. */
  recoveryCode: z.string().min(8).max(32).optional(),
});

/**
 * Login is not routed through the API kernel: there is no Ctx to resolve yet and no
 * permission to assert. It therefore does its own rate limiting and auditing.
 *
 * Every failure path below returns the same body and status, and performs the same
 * amount of hashing work, so a caller cannot distinguish unknown-email from
 * wrong-password from locked-account.
 */
export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  const ip = clientIp(req) ?? 'unknown';
  const ua = req.headers.get('user-agent');

  try {
    const body = await readJsonBody(req, bodySchema);
    // A throttled login must not read as wrong credentials: rethrow with a
    // message the form shows verbatim.
    try {
      await consume(limits.loginPerIp(ip));
      await consume(limits.loginPerAccount(body.email));
    } catch (limited) {
      const retryAfter = (limited as { retryAfter?: number }).retryAfter;
      const err: Error & { retryAfter?: number } = TooManyRequests(
        'Too many sign-in attempts. Wait a few minutes and try again.',
      );
      err.retryAfter = retryAfter;
      throw err;
    }

    const normalizedEmail = body.email.trim().toLowerCase();
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

    const now = new Date();

    if (!user || user.deletedAt || !user.passwordHash) {
      await burnTiming();
      await recordFailure(null, null, ip, ua, requestId, 'UNKNOWN_ACCOUNT');
      throw Unauthorized(GENERIC);
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      await burnTiming();
      await recordFailure(null, user.id, ip, ua, requestId, 'LOCKED');
      throw Unauthorized(GENERIC);
    }

    if (user.status !== 'ACTIVE') {
      await burnTiming();
      await recordFailure(null, user.id, ip, ua, requestId, 'INACTIVE');
      throw Unauthorized(GENERIC);
    }

    const memberships = (await hydrateSalesUsers(user.memberships)).filter(isActiveWorkspaceMembership);
    if (user.platformRole === 'USER' && memberships.length === 0) {
      await burnTiming();
      await recordFailure(null, user.id, ip, ua, requestId, 'NO_ACTIVE_WORKSPACE');
      throw Unauthorized(GENERIC);
    }

    const ok = await verifyPassword(user.passwordHash, body.password);
    if (!ok) {
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
      await recordFailure(null, user.id, ip, ua, requestId, locked ? 'LOCKED_NOW' : 'BAD_PASSWORD');
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
            ipAddress: ip,
            userAgent: ua,
            requestId,
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
        { status: 200, headers: { 'x-request-id': requestId } },
      );
    }

    const activeMembership = memberships[0] ?? null;
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
    const mfaRequired =
      user.mfaEnabled || settings?.mfaRequired === true || isPrivilegedPlatformRole(user.platformRole);

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
        ip,
        userAgent: ua,
        mfaSatisfied: false,
        purpose: 'MFA_ENROLMENT',
      });
      await prisma.platformAuditEvent
        .create({
          data: {
            tenantId: activeMembership?.tenantId,
            actorUserId: user.id,
            event: 'LOGIN',
            objectType: 'platform_user',
            objectId: user.id,
            ipAddress: ip,
            userAgent: ua,
            requestId,
            metadata: { mfa: false, purpose: 'MFA_ENROLMENT' },
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
        { status: 200, headers: { 'x-request-id': requestId } },
      );
    }

    // MFA is verified on a second call; the session below is created only after it
    // succeeds, so an unverified session never exists.
    if (mfaRequired && !body.mfaCode && !body.recoveryCode) {
      return NextResponse.json({ mfaRequired: true }, { status: 200, headers: { 'x-request-id': requestId } });
    }
    if (mfaRequired && (body.mfaCode || body.recoveryCode)) {
      const { verifyTotp } = await import('@/lib/auth/mfa');
      const { decryptSecret } = await import('@/services/identity/secrets');
      const { consumeRecoveryCode } = await import('@/services/identity/twoFactor');

      // The secret is stored encrypted; values enrolled before that change are
      // passed through unchanged by decryptSecret.
      const byTotp = Boolean(body.mfaCode && user.mfaSecret && verifyTotp(decryptSecret(user.mfaSecret), body.mfaCode));
      // A recovery code is spent here, so a captured one is worthless twice.
      const byRecovery =
        !byTotp && Boolean(body.recoveryCode) && (await consumeRecoveryCode(user.id, body.recoveryCode!));

      if (!byTotp && !byRecovery) {
        await recordFailure(activeMembership?.tenantId ?? null, user.id, ip, ua, requestId, 'BAD_MFA');
        throw Unauthorized(GENERIC);
      }
      if (byRecovery) {
        await prisma.platformAuditEvent
          .create({
            data: {
              tenantId: activeMembership?.tenantId,
              actorUserId: user.id,
              event: 'LOGIN',
              objectType: 'platform_user',
              objectId: user.id,
              ipAddress: ip,
              userAgent: ua,
              requestId,
              metadata: { mfa: true, viaRecoveryCode: true },
            },
          })
          .catch(() => {});
      }
    }

    await prisma.platformUser.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });

    const session = await createPlatformSession({
      platformUserId: user.id,
      activeTenantId: activeMembership?.tenantId ?? null,
      ip,
      userAgent: ua,
      mfaSatisfied: mfaRequired,
    });

    // Resolved against the workspace being entered. A platform owner with no
    // membership has no workspace policy to age out against, and the temporary
    // -password half of the predicate still applies to them.
    const mustChangePassword = activeMembership
      ? passwordExpired(user.passwordChangedAt, await passwordPolicy(activeMembership.tenantId))
      : user.passwordChangedAt === null;

    await prisma.platformAuditEvent.create({
      data: {
        tenantId: activeMembership?.tenantId,
        actorUserId: user.id,
        event: 'LOGIN',
        objectType: 'platform_user',
        objectId: user.id,
        ipAddress: ip,
        userAgent: ua,
        requestId,
        metadata: { mfa: mfaRequired, platformRole: user.platformRole },
      },
    });

    return NextResponse.json(
      {
        user: { id: user.id, fullName: user.fullName, email: user.email, platformRole: user.platformRole },
        activeWorkspace: activeMembership
          ? {
              id: activeMembership.tenant.id,
              slug: activeMembership.tenant.slug,
              displayName: activeMembership.tenant.displayName,
            }
          : null,
        workspaces: memberships.map((membership) => ({
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
        //
        // Surfaced here so the client routes straight to the change screen rather
        // than discovering it on the first redirect.
        mustChangePassword,
        destination:
          mustChangePassword && activeMembership
            ? `/${activeMembership.tenant.slug}/profile/security`
            : user.platformRole === 'OWNER' && !activeMembership
              ? '/platform'
              : activeMembership
                ? `/${activeMembership.tenant.slug}/dashboard`
                : '/login',
        expiresAt: session.expiresAt,
      },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    if (err instanceof AppError) {
      const headers: Record<string, string> = { 'x-request-id': requestId };
      if ((err as any).retryAfter) headers['retry-after'] = String((err as any).retryAfter);
      return NextResponse.json(err.toProblem(requestId), { status: err.status, headers });
    }
    logger.error({ err, requestId }, 'login failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}

const GENERIC = 'That email and password combination did not work.';

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
  ip: string,
  ua: string | null,
  requestId: string,
  reason: string,
) {
  await prisma.platformAuditEvent
    .create({
      data: {
        tenantId,
        actorUserId: userId,
        event: 'LOGIN_FAILED',
        objectType: 'platform_user',
        objectId: userId,
        ipAddress: ip,
        userAgent: ua,
        requestId,
        metadata: { reason },
      },
    })
    .catch(() => {});
}
