import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AppError, Invalid, Unauthorized } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { hashPassword, checkPolicy, DEFAULT_POLICY } from '@/lib/auth/password';
import { passwordPolicy } from '@/services/identity/accounts';
import { assertNotReused, recordPreviousPassword } from '@/services/identity/passwordHistory';
import { revokeAllPlatformSessions } from '@/lib/auth/session';
import { readJsonBody } from '@/lib/api/read-body';

/**
 * No `tenantSlug`. The token names the workspace it was issued for; asking the
 * caller to repeat it added a field nobody knows and a second way to be wrong.
 */
const bodySchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(1).max(512),
});

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();

  try {
    const body = await readJsonBody(req, bodySchema);

    // Checked twice: once against the platform default before the token is even
    // looked up, so a hopeless password costs nothing and reveals nothing, and
    // again below against the *workspace's* policy once the token has told us
    // which workspace this is. A reset must not be the one door through which a
    // password weaker than the company requires can be set.
    const problems = checkPolicy(body.newPassword, DEFAULT_POLICY);
    if (problems.length) {
      throw Invalid(problems.map((message) => ({ field: 'newPassword', code: 'policy', message })));
    }

    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(body.token) },
    });

    const now = new Date();
    if (!record || record.usedAt || record.expiresAt < now) {
      throw Unauthorized('This reset link is invalid or has expired.');
    }
    // The credential lives on PlatformUser and nowhere else. This route used to
    // write the User copy instead, which login never reads — so the reset was
    // inert and the old, possibly leaked, password kept working.
    const platformUserId = record.platformUserId;
    if (!platformUserId) {
      // Issued before tokens named their platform identity; long expired by now.
      throw Unauthorized('This reset link is invalid or has expired.');
    }

    // The workspace is optional (a platform-only account has none), but one the
    // token names must still be entitled to have anyone sign in at all.
    const tenant = record.tenantId ? await prisma.tenant.findUnique({ where: { id: record.tenantId } }) : null;
    if (record.tenantId && (!tenant || tenant.deletedAt || tenant.status !== 'ACTIVE')) {
      throw Unauthorized('This reset link is invalid or has expired.');
    }

    const policy = tenant ? await passwordPolicy(tenant.id) : DEFAULT_POLICY;
    const weak = checkPolicy(body.newPassword, policy);
    if (weak.length) {
      throw Invalid(weak.map((message) => ({ field: 'newPassword', code: 'policy', message })));
    }
    // The reuse window applies here too. A forgotten password is the most likely
    // moment for someone to reach for one they have used before, which is
    // precisely what the rule exists to prevent.
    await assertNotReused(platformUserId, body.newPassword, policy);

    const previous = await prisma.platformUser.findUnique({
      where: { id: platformUserId },
      select: { passwordHash: true },
    });
    const passwordHash = await hashPassword(body.newPassword);

    await prisma.$transaction([
      prisma.platformUser.update({
        where: { id: platformUserId },
        data: { passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null },
      }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: now } }),
    ]);
    await recordPreviousPassword(platformUserId, previous?.passwordHash ?? null);

    // A password reset invalidates every existing session — the whole point of the
    // flow. There is one session store, keyed by platform identity.
    await revokeAllPlatformSessions(platformUserId, 'PASSWORD_RESET');

    // The workspace audit log needs a workspace; the platform log takes either.
    if (tenant && record.userId) {
      await prisma.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: record.userId,
          actorType: 'USER',
          event: 'PASSWORD_CHANGED',
          objectType: 'user',
          recordId: record.userId,
          requestId,
        },
      });
    } else {
      await prisma.platformAuditEvent.create({
        data: {
          actorUserId: platformUserId,
          event: 'PASSWORD_RESET',
          objectType: 'platform_user',
          objectId: platformUserId,
          requestId,
          ipAddress: record.ipAddress,
          userAgent: record.userAgent,
          metadata: { result: 'ok', via: 'reset-link' },
        },
      });
    }

    return NextResponse.json({ ok: true }, { headers: { 'x-request-id': requestId } });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(err.toProblem(requestId), {
        status: err.status,
        headers: { 'x-request-id': requestId },
      });
    }
    logger.error({ err, requestId }, 'reset-password failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}
