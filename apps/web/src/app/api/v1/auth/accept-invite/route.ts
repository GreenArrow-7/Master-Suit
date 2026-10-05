import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Forbidden } from '@/lib/errors';
import { clientIp } from '@/lib/auth/session';
import { consume, limits } from '@/lib/security/ratelimit';
import { acceptInvitation, previewInvitation } from '@/services/identity/invitations';
import { bareRoute } from '@/lib/api/handler';

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
export const GET = bareRoute('/api/v1/auth/accept-invite', async (req) => {
  await consume(limits.inviteLookup(clientIp(req) ?? 'unknown'));
  const token = new URL(req.url).searchParams.get('token');
  if (!token) throw Forbidden('This invitation link is invalid, expired, or has already been used.');

  const preview = await previewInvitation(token);
  if (!preview) throw Forbidden('This invitation link is invalid, expired, or has already been used.');

  return NextResponse.json(preview);
});

export const POST = bareRoute('/api/v1/auth/accept-invite', async (req) => {
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
    { status: 201 },
  );
});
