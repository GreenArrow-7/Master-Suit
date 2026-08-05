import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError, Unauthorized } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { verifyPassword, burnTiming } from '@/lib/auth/password';
import { createPlatformSession, clientIp } from '@/lib/auth/session';
import { consume, limits } from '@/lib/security/ratelimit';
import { isActiveWorkspaceMembership } from '@/lib/auth/platform-policy';

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
    const body = bodySchema.parse(await req.json());
    await consume(limits.loginPerIp(ip));
    await consume(limits.loginPerAccount(body.email));

    const normalizedEmail = body.email.trim().toLowerCase();
    const user = await prisma.platformUser.findUnique({
      where: { normalizedEmail },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          include: { tenant: true, salesUser: { include: { role: true } } },
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

    const memberships = user.memberships.filter(isActiveWorkspaceMembership);
    if (user.platformRole === 'USER' && memberships.length === 0) {
      await burnTiming();
      await recordFailure(null, user.id, ip, ua, requestId, 'NO_ACTIVE_WORKSPACE');
      throw Unauthorized(GENERIC);
    }

    const ok = await verifyPassword(user.passwordHash, body.password);
    if (!ok) {
      const failures = user.failedLoginCount + 1;
      const locked = failures >= env.MAX_FAILED_LOGINS;
      await prisma.platformUser.update({
        where: { id: user.id },
        data: {
          failedLoginCount: locked ? 0 : failures,
          lockedUntil: locked ? new Date(now.getTime() + env.LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
        },
      });
      await recordFailure(null, user.id, ip, ua, requestId, locked ? 'LOCKED_NOW' : 'BAD_PASSWORD');
      throw Unauthorized(GENERIC);
    }

    const activeMembership = memberships[0] ?? null;
    const settings = activeMembership
      ? await prisma.organizationSetting.findUnique({ where: { tenantId: activeMembership.tenantId } })
      : null;
    const mfaRequired = user.mfaEnabled || settings?.mfaRequired === true;

    // MFA is verified on a second call; the session below is created only after it
    // succeeds, so an unverified session never exists.
    if (mfaRequired && !body.mfaCode && !body.recoveryCode) {
      return NextResponse.json(
        { mfaRequired: true, challengeToken: await issueChallenge(user.id) },
        { status: 200, headers: { 'x-request-id': requestId } },
      );
    }
    if (mfaRequired && (body.mfaCode || body.recoveryCode)) {
      const { verifyTotp } = await import('@/lib/auth/mfa');
      const { decryptSecret } = await import('@/services/identity/secrets');
      const { consumeRecoveryCode } = await import('@/services/identity/twoFactor');

      // The secret is stored encrypted; values enrolled before that change are
      // passed through unchanged by decryptSecret.
      const byTotp = Boolean(body.mfaCode && user.mfaSecret && verifyTotp(decryptSecret(user.mfaSecret), body.mfaCode));
      // A recovery code is spent here, so a captured one is worthless twice.
      const byRecovery = !byTotp && Boolean(body.recoveryCode) && await consumeRecoveryCode(user.id, body.recoveryCode!);

      if (!byTotp && !byRecovery) {
        await recordFailure(activeMembership?.tenantId ?? null, user.id, ip, ua, requestId, 'BAD_MFA');
        throw Unauthorized(GENERIC);
      }
      if (byRecovery) {
        await prisma.platformAuditEvent.create({
          data: {
            tenantId: activeMembership?.tenantId, actorUserId: user.id, event: 'LOGIN',
            objectType: 'platform_user', objectId: user.id, ipAddress: ip, userAgent: ua, requestId,
            metadata: { mfa: true, viaRecoveryCode: true },
          },
        }).catch(() => {});
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
          ? { id: activeMembership.tenant.id, slug: activeMembership.tenant.slug, displayName: activeMembership.tenant.displayName }
          : null,
        workspaces: memberships.map((membership) => ({
          id: membership.tenant.id,
          slug: membership.tenant.slug,
          displayName: membership.tenant.displayName,
          role: membership.salesUser?.role.key ?? membership.roleSnapshot,
        })),
        destination: user.platformRole === 'OWNER' && !activeMembership
          ? '/platform'
          : activeMembership ? `/${activeMembership.tenant.slug}/dashboard` : '/login',
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

async function recordFailure(
  tenantId: string | null, userId: string | null, ip: string, ua: string | null, requestId: string, reason: string,
) {
  await prisma.platformAuditEvent.create({
    data: {
      tenantId, actorUserId: userId, event: 'LOGIN_FAILED',
      objectType: 'platform_user', objectId: userId, ipAddress: ip, userAgent: ua, requestId,
      metadata: { reason },
    },
  }).catch(() => {});
}

async function issueChallenge(userId: string) {
  const { redis } = await import('@/lib/redis');
  const token = ulid();
  await redis.set(`mfa:challenge:${token}`, userId, 'EX', 300);
  return token;
}
