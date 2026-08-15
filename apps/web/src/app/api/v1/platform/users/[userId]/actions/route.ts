import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';
import {
  changeWorkspaceRole,
  resetMfa,
  resetPassword,
  setAccountActive,
  setMembershipStatus,
  setPlatformRole,
  unlockAccount,
} from '@/services/platform/identity';

/**
 * Every privileged recovery action on one account, behind one owner-only gate.
 *
 * A discriminated union rather than seven routes: they share the same guard, the
 * same audit shape and the same error handling, and splitting them would mean
 * copying `requirePlatformOwner` seven times — which is how one copy eventually
 * gets it wrong.
 */
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('reset-password'),
    // Absent means "generate one". Present means the owner typed it, which is
    // what a demo workspace with a published password needs.
    password: z.string().min(1).max(200).optional(),
    /** Forces the user to set their own before anything else opens. */
    requireChange: z.boolean().default(true),
  }),
  z.object({ action: z.literal('unlock') }),
  z.object({ action: z.literal('reset-mfa') }),
  z.object({ action: z.literal('set-active'), active: z.boolean() }),
  z.object({
    action: z.literal('set-platform-role'),
    platformRole: z.enum(['USER', 'OWNER', 'SUPPORT', 'SECURITY_AUDITOR']),
  }),
  z.object({
    action: z.literal('membership-status'),
    membershipId: z.string().min(1),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'REMOVED']),
  }),
  z.object({ action: z.literal('membership-role'), membershipId: z.string().min(1), roleId: z.string().min(1) }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const { userId } = await params;
    const body = bodySchema.parse(await req.json());

    const result = await run(ctx, userId, body);
    return NextResponse.json(result, {
      // A generated password is in this body. It must not sit in a shared cache
      // or a proxy log on the way back to the browser.
      headers: { 'x-request-id': requestId, 'cache-control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toProblem(requestId), {
        status: error.status,
        headers: { 'x-request-id': requestId },
      });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { status: 422, title: 'Validation failed', requestId, errors: error.flatten() },
        { status: 422 },
      );
    }
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}

type Ctx = Awaited<ReturnType<typeof requirePlatformOwner>>;

function run(ctx: Ctx, userId: string, body: z.infer<typeof bodySchema>) {
  switch (body.action) {
    case 'reset-password':
      return resetPassword(ctx, userId, { password: body.password, requireChange: body.requireChange });
    case 'unlock':
      return unlockAccount(ctx, userId);
    case 'reset-mfa':
      return resetMfa(ctx, userId);
    case 'set-active':
      return setAccountActive(ctx, userId, body.active);
    case 'set-platform-role':
      return setPlatformRole(ctx, userId, body.platformRole);
    case 'membership-status':
      return setMembershipStatus(ctx, body.membershipId, body.status);
    case 'membership-role':
      return changeWorkspaceRole(ctx, body.membershipId, body.roleId);
  }
}
