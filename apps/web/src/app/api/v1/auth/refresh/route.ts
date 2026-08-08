import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError, Unauthorized } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { SESSION_COOKIE, clientIp, createPlatformSession } from '@/lib/auth/session';

/**
 * Rotates the session token.
 *
 * The session cookie is a bearer credential: anyone holding it is the user until
 * it expires. Rotation bounds how long a copied cookie stays useful — the old
 * token is revoked the moment a new one is issued, so a stolen cookie either
 * gets used before the legitimate client next refreshes, or stops working.
 *
 * Reusing an already-rotated token is treated as theft rather than a mistake:
 * either the real client or an attacker is replaying, and there is no way to
 * tell which, so **every** session for that account is revoked and both parties
 * have to sign in again. That is the standard refresh-token-rotation response
 * and it is deliberately unforgiving.
 */
export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) throw Unauthorized();

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const session = await prisma.platformSession.findUnique({
      where: { tokenHash },
      // Only what the checks below read. `true` would pull the credential
      // columns into a rotation that has no use for them.
      include: { platformUser: { select: { id: true, status: true, deletedAt: true } } },
    });
    if (!session) throw Unauthorized('Your session has expired.');

    if (session.revokedAt) {
      // A token that was already rotated away is being presented again.
      await prisma.platformSession.updateMany({
        where: { platformUserId: session.platformUserId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED_TOKEN_REPLAYED' },
      });
      await prisma.platformAuditEvent
        .create({
          data: {
            tenantId: session.activeTenantId,
            actorUserId: session.platformUserId,
            event: 'LOGIN_FAILED',
            objectType: 'platform_session',
            objectId: session.id,
            ipAddress: clientIp(req),
            userAgent: req.headers.get('user-agent'),
            requestId,
            metadata: { reason: 'ROTATED_TOKEN_REPLAYED' },
          },
        })
        .catch(() => {});
      jar.delete(SESSION_COOKIE);
      throw Unauthorized('Your session has expired.');
    }

    const now = new Date();
    if (session.expiresAt < now) throw Unauthorized('Your session has expired.');

    const idleCutoff = new Date(now.getTime() - env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000);
    if (session.lastSeenAt < idleCutoff) {
      await prisma.platformSession.update({
        where: { id: session.id },
        data: { revokedAt: now, revokedReason: 'IDLE_TIMEOUT' },
      });
      throw Unauthorized('Your session timed out.');
    }

    const user = session.platformUser;
    if (!user || user.deletedAt || user.status !== 'ACTIVE') throw Unauthorized();

    // New token first, then revoke the old one: if issuing fails, the caller
    // still holds a working session rather than being signed out by a fault.
    const rotated = await createPlatformSession({
      platformUserId: user.id,
      activeTenantId: session.activeTenantId,
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
      mfaSatisfied: session.mfaSatisfied,
    });
    await prisma.platformSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
    });

    return NextResponse.json({ expiresAt: rotated.expiresAt }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toProblem(requestId), {
        status: error.status,
        headers: { 'x-request-id': requestId },
      });
    }
    logger.error({ err: error, requestId }, 'session refresh failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}
