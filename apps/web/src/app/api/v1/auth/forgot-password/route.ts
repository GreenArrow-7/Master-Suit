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

const bodySchema = z.object({
  tenantSlug: z.string().min(1).max(64),
  email: z.string().email().max(254),
});

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const RESET_TTL_MINUTES = 30;

/**
 * Always returns the same 200 body whether or not the account exists — a
 * distinguishable response here is an account-enumeration leak. See the login
 * route for the same pattern.
 */
export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  const ip = clientIp(req) ?? 'unknown';

  try {
    const body = bodySchema.parse(await req.json());
    await consume(limits.passwordReset(body.email));

    const tenant = await prisma.tenant.findUnique({ where: { slug: body.tenantSlug } });
    const user = tenant
      ? await prisma.user.findFirst({
          where: { tenantId: tenant.id, email: body.email.toLowerCase(), deletedAt: null, status: 'ACTIVE' },
        })
      : null;

    if (tenant && user) {
      const token = randomBytes(32).toString('base64url');
      await prisma.passwordResetToken.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          tokenHash: sha256(token),
          ipAddress: ip,
          userAgent: req.headers.get('user-agent'),
          expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
        },
      });

      const link = `${env.APP_URL}/reset-password?token=${token}&tenant=${tenant.slug}`;
      await sendMail(user.email, 'Reset your password', `Reset your password: ${link}\n\nThis link expires in ${RESET_TTL_MINUTES} minutes.`);
    }

    return NextResponse.json(
      { ok: true, message: 'If that account exists, a reset link has been sent.' },
      { headers: { 'x-request-id': requestId } },
    );
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
