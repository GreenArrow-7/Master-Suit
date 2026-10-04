import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { Forbidden } from '@/lib/errors';
import { resolvePlatformCtx, type PlatformCtx } from '@/lib/auth/session';
import { isPlatformStaff } from '@/lib/auth/credentials';
import { readJsonBody } from '@/lib/api/read-body';
import {
  changeOwnAdministrationPassword,
  credentialStatus,
  revokeOwnMonitoringCredential,
  setOwnMonitoringCredential,
} from '@/services/identity/platformCredentials';
import { toResponse } from '@/lib/api/handler';

/**
 * A platform staff member's own two passwords.
 *
 *   GET                                  what is set (never a hash)
 *   POST { action: 'set-monitoring' }    set or replace the monitoring password
 *   POST { action: 'revoke-monitoring' } remove it; the administration password is untouched
 *   POST { action: 'change-admin-password' }
 *
 * The target of every change is named explicitly by the action — there is no
 * "change password" that could land on either credential.
 *
 * Only the signed-in identity, only from an administration session, and every
 * POST re-authenticates with the current administration password and a fresh
 * authenticator code. A monitoring session manages neither credential; an
 * enrolment-only grant is not accepted at all (`resolvePlatformCtx` defaults to
 * FULL sessions). See services/identity/platformCredentials.ts.
 */
const proof = { currentPassword: z.string().min(1).max(512), mfaCode: z.string().length(6) };

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set-monitoring'), ...proof, newPassword: z.string().min(1).max(512) }).strict(),
  z.object({ action: z.literal('revoke-monitoring'), ...proof }).strict(),
  z.object({ action: z.literal('change-admin-password'), ...proof, newPassword: z.string().min(1).max(512) }).strict(),
]);

async function requireAdministrationSession(req: Request, requestId: string): Promise<PlatformCtx> {
  const ctx = await resolvePlatformCtx(req, requestId);
  if (!isPlatformStaff(ctx.platformRole)) throw Forbidden('Only platform staff manage credentials here.');
  if (ctx.credentialPurpose !== 'PLATFORM_ADMIN') {
    throw Forbidden('Credentials are managed from a session signed in with your administration password.');
  }
  return ctx;
}

export async function GET(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await requireAdministrationSession(req, requestId);
    return NextResponse.json(await credentialStatus(ctx.platformUserId), {
      headers: { 'x-request-id': requestId, 'cache-control': 'no-store' },
    });
  } catch (error) {
    return toResponse(error, requestId, { route: '/api/v1/platform/credentials' });
  }
}

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await requireAdministrationSession(req, requestId);
    const body = await readJsonBody(req, bodySchema);
    const actor = {
      platformUserId: ctx.platformUserId,
      sessionId: ctx.sessionId,
      requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    };
    const result =
      body.action === 'set-monitoring'
        ? await setOwnMonitoringCredential(actor, body)
        : body.action === 'revoke-monitoring'
          ? await revokeOwnMonitoringCredential(actor, body)
          : await changeOwnAdministrationPassword(actor, body);
    return NextResponse.json(result, { headers: { 'x-request-id': requestId, 'cache-control': 'no-store' } });
  } catch (error) {
    return toResponse(error, requestId, { route: '/api/v1/platform/credentials' });
  }
}
