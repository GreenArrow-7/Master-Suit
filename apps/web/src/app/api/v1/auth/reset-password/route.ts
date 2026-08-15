import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AppError, Invalid, Unauthorized } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { hashPassword, checkPolicy, DEFAULT_POLICY } from '@/lib/auth/password';
import { revokeAllSessions } from '@/lib/auth/session';
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
    const tenant = await prisma.tenant.findUnique({ where: { id: record.tenantId } });
    if (!tenant || tenant.deletedAt || tenant.status !== 'ACTIVE') {
      throw Unauthorized('This reset link is invalid or has expired.');
    }

    const passwordHash = await hashPassword(body.newPassword);

    // The credential lives on PlatformUser and nowhere else. This route used to
    // write the User copy instead, which login never reads — so the reset was
    // inert and the old, possibly leaked, password kept working.
    const membership = await prisma.workspaceMembership.findUnique({
      where: { salesUserId: record.userId },
      select: { platformUserId: true },
    });
    if (!membership) {
      // No platform identity means no credential to reset. Fail rather than
      // reporting success on a write that could not authenticate anyone.
      logger.error({ requestId, userId: record.userId }, 'reset-password: user has no workspace membership');
      throw Unauthorized('This reset link is invalid or has expired.');
    }

    await prisma.$transaction([
      prisma.platformUser.update({
        where: { id: membership.platformUserId },
        data: { passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null },
      }),
      prisma.passwordResetToken.update({ where: { tenantId: tenant.id, id: record.id }, data: { usedAt: now } }),
    ]);

    // A password reset invalidates every existing session — the whole point of the
    // flow. revokeAllSessions covers both the Session and PlatformSession rows.
    await revokeAllSessions(tenant.id, record.userId, undefined, 'PASSWORD_RESET');

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
