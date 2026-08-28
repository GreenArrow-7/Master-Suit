import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AppError, Conflict, Forbidden, Unauthorized } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { generateSecret, otpauthUrl, verifyTotp } from '@/lib/auth/mfa';
import { verifyPassword } from '@/lib/auth/password';
import { encryptSecret, decryptSecret } from '@/services/identity/secrets';
import { resolvePlatformCtx, createPlatformSession, clientIp } from '@/lib/auth/session';
import { issueRecoveryCodes } from '@/services/identity/twoFactor';
import { isPlatformServiceRole } from '@/lib/auth/platform-policy';
import { consume, limits } from '@/lib/security/ratelimit';
import { readJsonBody } from '@/lib/api/read-body';

/**
 * First-run two-factor enrolment, reachable with an MFA_ENROLMENT grant.
 *
 * This is the one surface that grant opens. It exists because a workspace can
 * mandate 2FA for people who have not enrolled: before it, that setting demanded
 * a code from users who had no secret to produce one with, and locked them out
 * permanently.
 *
 * A FULL session is accepted too, so the same screen serves voluntary enrolment.
 * Confirming replaces the restricted grant with a real session — the enrolment
 * grant is revoked in the same transaction, so it cannot be replayed.
 */
const ALLOWED = ['FULL', 'MFA_ENROLMENT'] as const;

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await resolvePlatformCtx(req, requestId, ALLOWED);
    const body = await readJsonBody(
      req,
      z.object({
        step: z.enum(['begin', 'confirm']),
        code: z.string().length(6).optional(),
        currentPassword: z.string().min(1).max(512).optional(),
      }),
    );

    const user = await prisma.platformUser.findUnique({
      where: { id: ctx.platformUserId },
      select: {
        id: true,
        email: true,
        username: true,
        platformRole: true,
        mfaEnabled: true,
        mfaSecret: true,
        passwordHash: true,
      },
    });
    if (!user) throw Unauthorized();

    // A machine identity enrols here too — it is the same two-step ceremony and
    // there is no reason to build a second one — but it must leave with the
    // session its own login path issues, never the FULL session a human gets.
    const isService = isPlatformServiceRole(user.platformRole);

    if (body.step === 'begin') {
      if (user.mfaEnabled) throw Conflict('Two-factor authentication is already enabled on this account.');

      /**
       * Voluntary enrolment re-authenticates; forced first-run enrolment does not.
       *
       * An MFA_ENROLMENT grant is minted seconds after a successful password
       * check, is the only thing that reaches this route, and is revoked the
       * moment enrolment completes — the password has already been proven and
       * asking again would only strand someone the workspace is compelling to
       * enrol. A FULL session is different: it may be hours old, or stolen, and
       * whoever completes enrolment holds a factor on the account and leaves
       * with the recovery codes. Same rule as identity/self/two-factor-begin.
       */
      if (ctx.purpose === 'FULL') {
        await consume(limits.mfaConfirm(user.id));
        if (!body.currentPassword) throw Forbidden('Enter your password to set up two-factor authentication.');
        if (!user.passwordHash || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
          throw Forbidden('That password is not correct.');
        }
      }
      const secret = generateSecret();
      await prisma.platformUser.update({ where: { id: user.id }, data: { mfaSecret: encryptSecret(secret) } });
      return NextResponse.json(
        {
          secret,
          // The label the authenticator app shows. For a service identity that
          // is its username — the thing an operator actually signs in with —
          // rather than an internal address nothing delivers to.
          otpauthUrl: otpauthUrl(secret, user.username ?? user.email),
          note: 'Scan this with an authenticator app, then confirm with a code. Nothing is switched on until you do.',
        },
        { headers: { 'x-request-id': requestId } },
      );
    }

    // confirm
    await consume(limits.mfaConfirm(user.id));
    if (!body.code) throw Forbidden('Enter the six-digit code from your authenticator.');
    if (!user.mfaSecret) throw Conflict('Start enrolment before confirming a code.');
    if (!verifyTotp(decryptSecret(user.mfaSecret), body.code)) {
      throw Forbidden('That code did not match. Check your authenticator clock and try the current code.');
    }

    const { codes, hashed } = issueRecoveryCodes();
    await prisma.platformUser.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaRecoveryCodes: hashed },
    });
    await prisma.authenticationFactor.create({
      data: { platformUserId: user.id, type: 'TOTP', verifiedAt: new Date() },
    });

    // The restricted grant has done its job. Revoke it before issuing the real
    // session, so a captured enrolment token is worthless the moment enrolment
    // completes.
    await prisma.platformSession.update({
      where: { id: ctx.sessionId },
      data: { revokedAt: new Date(), revokedReason: 'MFA_ENROLMENT_COMPLETED' },
    });
    const session = await createPlatformSession({
      platformUserId: user.id,
      activeTenantId: ctx.activeTenantId,
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
      mfaSatisfied: true,
      // Not FULL for a machine identity: resolvePlatformCtx refuses an
      // AI_SERVICE identity holding a FULL session, because that is the shape
      // the human login route issues and reaching one would mean the dedicated
      // path had been bypassed. Enrolment must hand back the same restricted
      // session service-login would.
      purpose: isService ? 'AI_SERVICE' : 'FULL',
    });

    await prisma.platformAuditEvent
      .create({
        data: {
          tenantId: ctx.activeTenantId,
          actorUserId: user.id,
          event: 'MFA_ENROLLED',
          objectType: 'platform_user',
          objectId: user.id,
          requestId,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { action: 'mfa.enrolled.first_run' },
        },
      })
      .catch(() => {});

    return NextResponse.json(
      {
        enabled: true,
        recoveryCodes: codes,
        expiresAt: session.expiresAt,
        note: 'Store these somewhere safe. Each works once, they are shown only now, and they are the only way back in if you lose the authenticator.',
      },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toProblem(requestId), {
        status: error.status,
        headers: { 'x-request-id': requestId },
      });
    }
    logger.error({ err: error, requestId }, 'two-factor enrolment failed');
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}

// The private `generateRecoveryCodes` that lived here is gone. It minted codes
// from `randomBytes(5)` — forty bits against an unsalted SHA-256 — while
// services/identity/twoFactor.ts had already moved to ten bytes for exactly
// that reason. Two copies, one of them fixed, and no way to see the other from
// where the fix was made. Both now call `issueRecoveryCodes`.
