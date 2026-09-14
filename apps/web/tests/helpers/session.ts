import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { isPlatformStaff } from '@/lib/auth/credentials';

/**
 * A signed-in workspace user, as a Cookie header value.
 *
 * Takes the workspace-actor (`User`) id that fixtures deal in, and issues the
 * session a real login would: a PlatformSession with that workspace active.
 *
 * It used to write a legacy `Session` row instead. That row was the *only*
 * reason the legacy branch of resolveCtx still existed — nothing in the
 * application created one — and that branch, unlike the platform one, never
 * checked `tenant.status`. So every permission test in the suite ran through a
 * code path production does not have, and one that would have let a suspended
 * workspace keep working.
 */
export async function createSessionToken(tenantId: string, userId: string): Promise<string> {
  const membership = await prisma.workspaceMembership.findFirst({
    where: { tenantId, salesUserId: userId },
    select: { platformUserId: true },
  });
  if (!membership) {
    // Loud rather than a silent 401 fifty assertions later.
    throw new Error(
      `No WorkspaceMembership links User ${userId} to tenant ${tenantId}. ` +
        'Fixtures must create the membership before minting a session.',
    );
  }
  return createPlatformSessionToken(membership.platformUserId, tenantId);
}

/**
 * The platform-session equivalent: what a real login issues. Needed for anything
 * reaching requirePlatformOwner, and for the workspace-scoped branch of
 * resolveCtx that runs off activeTenantId rather than a legacy Session row.
 */
export async function createPlatformSessionToken(
  platformUserId: string,
  activeTenantId: string | null = null,
  /**
   * Defaults match a completed sign-in. `mfaSatisfied` is overridable so the
   * platform-MFA suite can mint the password-only session that
   * resolvePlatformCtx must now refuse — it is a server-side column, never
   * something a client can assert.
   */
  options: {
    mfaSatisfied?: boolean;
    purpose?: 'FULL' | 'MFA_ENROLMENT' | 'AI_SERVICE';
    /**
     * Which of a staff identity's passwords the sign-in proved. Staff sessions
     * default to the administration password at its current version, as a real
     * login issues; `null` mints the purpose-less legacy session the application
     * must refuse. Ignored for workspace users and machine sessions, whose
     * sessions carry no purpose.
     */
    credentialPurpose?: 'PLATFORM_ADMIN' | 'MONITORING' | null;
  } = {},
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const purpose = options.purpose ?? 'FULL';
  const identity = await prisma.platformUser.findUnique({
    where: { id: platformUserId },
    select: { platformRole: true, passwordVersion: true, monitoringPasswordVersion: true },
  });
  const credentialPurpose =
    identity && purpose !== 'AI_SERVICE' && isPlatformStaff(identity.platformRole)
      ? options.credentialPurpose === undefined
        ? 'PLATFORM_ADMIN'
        : options.credentialPurpose
      : null;
  const credentialVersion =
    credentialPurpose === 'MONITORING'
      ? identity!.monitoringPasswordVersion
      : credentialPurpose === 'PLATFORM_ADMIN'
        ? identity!.passwordVersion
        : null;
  await prisma.platformSession.create({
    data: {
      platformUserId,
      activeTenantId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      mfaSatisfied: options.mfaSatisfied ?? true,
      purpose,
      credentialPurpose,
      credentialVersion,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  return `${SESSION_COOKIE}=${token}`;
}
