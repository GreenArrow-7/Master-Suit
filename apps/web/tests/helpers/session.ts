import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { SESSION_COOKIE } from '@/lib/auth/session';

/**
 * Mints a real session row and returns it as a Cookie header value.
 *
 * lib/auth/session.ts cannot be reused directly here: createSession also writes
 * the cookie through next/headers, which needs a request scope that a direct
 * handler call does not have. The row it writes is the same shape.
 */
export async function createSessionToken(tenantId: string, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await prisma.session.create({
    data: {
      tenantId,
      userId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      mfaSatisfied: true,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  return `${SESSION_COOKIE}=${token}`;
}
