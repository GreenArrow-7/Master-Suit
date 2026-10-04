import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { Unauthorized } from '@/lib/errors';
import { SESSION_COOKIE, clientIp, loadSession, revokeAllPlatformSessions } from '@/lib/auth/session';
import { toResponse } from '@/lib/api/handler';

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

    const session = await loadSession(token, new Date());
    if (!session) throw Unauthorized('Your session has expired.');

    const signedOut = await revokeAllPlatformSessions(session.platformUserId, 'USER_LOGOUT_ALL');

    await prisma.platformAuditEvent
      .create({
        data: {
          tenantId: session.activeTenantId,
          actorUserId: session.platformUserId,
          event: 'LOGOUT',
          objectType: 'platform_user',
          objectId: session.platformUserId,
          ipAddress: clientIp(req),
          userAgent: req.headers.get('user-agent'),
          requestId,
          metadata: { scope: 'all-devices', platformSessions: signedOut },
        },
      })
      .catch(() => {});

    jar.delete(SESSION_COOKIE);
    return NextResponse.json({ ok: true, signedOut }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    return toResponse(error, requestId, { route: '/api/v1/auth/logout-all' });
  }
}
