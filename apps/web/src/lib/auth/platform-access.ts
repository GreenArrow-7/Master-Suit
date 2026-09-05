import { prisma, withPlatformTx } from '../db';
import { Forbidden, Invalid } from '../errors';

/**
 * Break-glass: time-boxed write access into one customer workspace.
 *
 * ── What was here before ────────────────────────────────────────────────────
 *
 * `buildSupportActor` gave a platform OWNER every permission in every tenant at
 * ORGANIZATION scope — create, edit, delete, approve, sensitive fields — from
 * the moment they opened a workspace, forever, with no record of why. SUPPORT
 * and SECURITY_AUDITOR were already read-only. The difference was invisible: the
 * workspace-entry audit row recorded `mode: 'platform_support_readonly'` for a
 * session that could delete a customer's payroll.
 *
 * Reading a customer's data and changing it are different acts, and only the
 * first should be ambient. Opening a workspace still needs no ceremony; changing
 * something in it now needs a stated reason and a clock.
 *
 * ── Enforced on read, not on a timer ────────────────────────────────────────
 *
 * There is no job that closes expired grants. `activeGrant` compares `expiresAt`
 * to now on every request, so access ends on time whether or not anything
 * remembers to tidy up — and a sweeper that fails to run cannot silently extend
 * somebody's authority. Rows are left in place because they are the record of
 * who was in a customer's data and why, which is the second reason this exists.
 */

/**
 * The default window, and the ceiling.
 *
 * Thirty minutes is longer than the fix that motivates most elevations and short
 * enough that walking away from a laptop is not a standing grant. Four hours is
 * the cap for the genuinely long job — a data repair across a large workspace —
 * and asking again is cheap, whereas a grant nobody can end is not.
 */
export const DEFAULT_GRANT_MINUTES = 30;
export const MAX_GRANT_MINUTES = 240;

/**
 * Long enough to be a sentence. "fix" is not a reason; it is a word.
 *
 * Exported so the console can refuse the same input the API refuses, and say so
 * before the round trip rather than after. Two copies of this number would drift
 * into a form that accepts what the server rejects.
 */
export const MIN_REASON = 12;

export interface AccessGrant {
  id: string;
  tenantId: string;
  reason: string;
  grantedAt: Date;
  expiresAt: Date;
}

/**
 * The caller's live write grant for this workspace, or null.
 *
 * `revokedAt: null` and `expiresAt > now`, both checked in the query so a
 * revoked-and-expired grant cannot be resurrected by a clock skew on one side.
 */
export async function activeGrant(platformUserId: string, tenantId: string): Promise<AccessGrant | null> {
  const grant = await prisma.platformAccessGrant.findFirst({
    where: { platformUserId, tenantId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: 'desc' },
    select: { id: true, tenantId: true, reason: true, grantedAt: true, expiresAt: true },
  });
  return grant;
}

/**
 * Opens one.
 *
 * Refuses a second concurrent grant for the same person and workspace rather
 * than stacking them: two live grants means two expiry times, and the question
 * "when does this person's access end" stops having one answer.
 */
export async function openGrant(input: {
  platformUserId: string;
  tenantId: string;
  reason: string;
  minutes?: number;
  requestId?: string;
}): Promise<AccessGrant> {
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON) {
    throw Invalid([
      {
        field: 'reason',
        code: 'invalid',
        message: `Say why you need to change this customer's data — at least ${MIN_REASON} characters. It is written to the workspace's audit trail.`,
      },
    ]);
  }

  const minutes = Math.min(Math.max(Math.round(input.minutes ?? DEFAULT_GRANT_MINUTES), 1), MAX_GRANT_MINUTES);

  const existing = await activeGrant(input.platformUserId, input.tenantId);
  if (existing) {
    throw Forbidden(
      `You already have write access to this workspace until ${existing.expiresAt.toISOString()}. ` +
        'Hand it back before opening another.',
    );
  }

  const grant = await prisma.platformAccessGrant.create({
    data: {
      tenantId: input.tenantId,
      platformUserId: input.platformUserId,
      reason,
      expiresAt: new Date(Date.now() + minutes * 60_000),
      requestId: input.requestId ?? null,
    },
    select: { id: true, tenantId: true, reason: true, grantedAt: true, expiresAt: true },
  });
  return grant;
}

/** Hands it back early. Idempotent: closing what is already closed is not an error. */
export async function revokeGrants(platformUserId: string, tenantId: string): Promise<number> {
  const { count } = await prisma.platformAccessGrant.updateMany({
    where: { platformUserId, tenantId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

/**
 * Every live grant across the platform. For the metrics endpoint.
 *
 * The one caller here that spans tenants, and therefore the one that needs
 * `withPlatformTx`. The table is under row-level security (20260826120000), so a
 * count with no tenant pinned and no `app.platform_admin` asserted does not
 * error — it returns 0, which is also the healthy value. A gauge that reads
 * "nobody has write access into a customer's data" while blind is worse than no
 * gauge at all.
 */
export async function liveGrantCount(): Promise<number> {
  return withPlatformTx((tx) =>
    tx.platformAccessGrant.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
  );
}
