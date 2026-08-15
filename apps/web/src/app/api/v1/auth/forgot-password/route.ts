import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { clientIp } from '@/lib/auth/session';
import { consume, limits } from '@/lib/security/ratelimit';
import { sendMail } from '@/lib/mailer';
import { readJsonBody } from '@/lib/api/read-body';

/**
 * Email only.
 *
 * This used to require a `tenantSlug` as well, which nobody locked out of their
 * account reliably knows, and which leaked information: a wrong slug behaved
 * differently from a wrong email. Since P1-9 the credential belongs to the
 * identity rather than to a workspace membership, so the workspace is resolved
 * server-side from the account.
 *
 * The response is identical whether or not the account exists, so it cannot be
 * used to enumerate addresses.
 */
const bodySchema = z.object({
  email: z.string().email().max(254),
});

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const RESET_TTL_MINUTES = 30;
const SAME_ANSWER = {
  ok: true,
  message: 'If that account exists, a reset link is on its way. Check your inbox and your spam folder.',
};

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  const ip = clientIp(req) ?? 'unknown';

  try {
    const body = await readJsonBody(req, bodySchema);
    const normalizedEmail = body.email.trim().toLowerCase();

    // Both keys, deliberately: per-address stops one account being spammed,
    // per-IP stops one client working through a list of addresses.
    await consume(limits.passwordReset(normalizedEmail));
    await consume(limits.passwordResetPerIp(ip));

    const identity = await prisma.platformUser.findUnique({
      where: { normalizedEmail },
      select: {
        id: true,
        email: true,
        status: true,
        deletedAt: true,
        memberships: {
          where: { status: 'ACTIVE', tenant: { status: 'ACTIVE', deletedAt: null } },
          select: { tenantId: true, salesUserId: true },
          orderBy: { joinedAt: 'asc' },
          take: 1,
        },
      },
    });

    const membership = identity?.memberships[0];
    const eligible = identity && !identity.deletedAt && identity.status === 'ACTIVE' && membership?.salesUserId;

    if (eligible) {
      const token = randomBytes(32).toString('base64url');
      await prisma.passwordResetToken.create({
        data: {
          tenantId: membership.tenantId,
          userId: membership.salesUserId!,
          tokenHash: sha256(token),
          ipAddress: ip,
          userAgent: req.headers.get('user-agent'),
          expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
        },
      });

      const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
      await sendMail(
        identity.email,
        'Reset your password',
        `Someone asked to reset the password for this account.\n\n${link}\n\n` +
          `The link expires in ${RESET_TTL_MINUTES} minutes and can be used once. ` +
          'If it was not you, no action is needed — nothing has changed.',
      );
    } else {
      // Not found, deleted, suspended, or in no active workspace. Recorded for
      // the security log; answered identically to the caller.
      logger.info({ requestId, reason: identity ? 'INELIGIBLE' : 'UNKNOWN_ACCOUNT' }, 'password reset not issued');
    }

    return NextResponse.json(SAME_ANSWER, { headers: { 'x-request-id': requestId } });
  } catch (err) {
    if (err instanceof AppError) {
      const headers: Record<string, string> = { 'x-request-id': requestId };
      if ((err as any).retryAfter) headers['retry-after'] = String((err as any).retryAfter);
      return NextResponse.json(err.toProblem(requestId), { status: err.status, headers });
    }
    logger.error({ err, requestId }, 'forgot-password failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}
