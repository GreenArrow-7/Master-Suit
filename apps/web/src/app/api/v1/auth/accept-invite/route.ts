import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { AppError, Forbidden } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { clientIp } from '@/lib/auth/session';
import { consume, limits } from '@/lib/security/ratelimit';
import { acceptInvitation, previewInvitation } from '@/services/identity/invitations';

/**
 * Redeeming an invitation. Unauthenticated by necessity — the whole point is
 * that the person does not have an account yet.
 *
 * The token is the only credential involved, so it is rate-limited by client:
 * without that, the endpoint is an oracle for guessing 256-bit tokens, and while
 * that is not a realistic attack it is a free one to forbid.
 */
const acceptSchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(1).max(512),
  fullName: z.string().min(2).max(160).optional(),
});

/** GET renders the confirmation screen: which workspace, which role, for whom. */
export async function GET(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    await consume(limits.inviteLookup(clientIp(req) ?? 'unknown'));
    const token = new URL(req.url).searchParams.get('token');
    if (!token) throw Forbidden('This invitation link is invalid, expired, or has already been used.');

    const preview = await previewInvitation(token);
    if (!preview) throw Forbidden('This invitation link is invalid, expired, or has already been used.');

    return NextResponse.json(preview, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    return problem(error, requestId, 'invitation preview failed');
  }
}

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    await consume(limits.inviteLookup(clientIp(req) ?? 'unknown'));
    const body = acceptSchema.parse(await req.json());
    const result = await acceptInvitation(body.token, { password: body.password, fullName: body.fullName });

    return NextResponse.json(
      {
        ...result,
        destination: `/${result.workspaceSlug}/dashboard`,
        note:
          result.credential === 'EXISTING'
            ? 'You already had an account on this platform. Sign in with your existing password — the one you just chose was not applied.'
            : 'Your account is ready. Sign in with the password you just chose.',
      },
      { status: 201, headers: { 'x-request-id': requestId } },
    );
  } catch (error) {
    return problem(error, requestId, 'invitation acceptance failed');
  }
}

function problem(error: unknown, requestId: string, message: string) {
  if (error instanceof AppError) {
    const headers: Record<string, string> = { 'x-request-id': requestId };
    if ((error as any).retryAfter) headers['retry-after'] = String((error as any).retryAfter);
    return NextResponse.json(error.toProblem(requestId), { status: error.status, headers });
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        status: 422,
        title: 'Validation failed',
        requestId,
        errors: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
      { status: 422, headers: { 'x-request-id': requestId } },
    );
  }
  logger.error({ err: error, requestId }, message);
  return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
}
