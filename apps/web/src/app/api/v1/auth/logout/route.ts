import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, revokeSession, resolveCtx } from '@/lib/auth/session';
import { audit } from '@/lib/security/audit';

/**
 * Not routed through the API kernel: a session about to be revoked should still be
 * able to log out even if resolveCtx would otherwise reject it (e.g. idle timeout).
 */
export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  if (token) {
    const ctx = await resolveCtx(req, requestId).catch(() => null);
    await revokeSession(token);
    if (ctx) await audit(ctx, { event: 'LOGOUT' });
  }

  return NextResponse.json({ ok: true }, { headers: { 'x-request-id': requestId } });
}
