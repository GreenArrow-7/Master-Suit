import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { AppError, Unauthorized } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { SESSION_COOKIE, clientIp } from '@/lib/auth/session';

/**
 * Signs the account out of every device, including this one.
 *
 * The case this exists for is "I think someone else has my session" — a laptop
 * left open, a shared machine, a phone lost. That means it must revoke the
 * caller's own session too: leaving the current one alive would be convenient
 * and would also leave the attacker's alive if the caller is the attacker's
 * victim on a different device.
 */
export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!token) throw Unauthorized();

    const session = await prisma.platformSession.findUnique({
      where: { tokenHash: createHash('sha256').update(token).digest('hex') },
      select: { platformUserId: true, activeTenantId: true, revokedAt: true, expiresAt: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) throw Unauthorized('Your session has expired.');

    const platform = await prisma.platformSession.updateMany({
      where: { platformUserId: session.platformUserId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'USER_LOGOUT_ALL' },
    });

    // The workspace-scoped sessions belong to the same person and must go too.
    const memberships = await prisma.workspaceMembership.findMany({
      where: { platformUserId: session.platformUserId },
      select: { tenantId: true, salesUserId: true },
    });
    let workspace = 0;
    for (const membership of memberships) {
      if (!membership.salesUserId) continue;
      const { count } = await prisma.session.updateMany({
        where: { tenantId: membership.tenantId, userId: membership.salesUserId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'USER_LOGOUT_ALL' },
      });
      workspace += count;
    }

    await prisma.platformAuditEvent.create({
      data: {
        tenantId: session.activeTenantId, actorUserId: session.platformUserId, event: 'LOGOUT',
        objectType: 'platform_user', objectId: session.platformUserId,
        ipAddress: clientIp(req), userAgent: req.headers.get('user-agent'), requestId,
        metadata: { scope: 'all-devices', platformSessions: platform.count, workspaceSessions: workspace },
      },
    }).catch(() => {});

    jar.delete(SESSION_COOKIE);
    return NextResponse.json(
      { ok: true, signedOut: platform.count + workspace },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toProblem(requestId), { status: error.status, headers: { 'x-request-id': requestId } });
    }
    logger.error({ err: error, requestId }, 'logout-all failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}
