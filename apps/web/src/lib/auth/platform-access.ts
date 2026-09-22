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
 * The same two numbers for a READ grant, and they are much larger on purpose.
 *
 * A write grant is held for the length of a repair; a monitoring authorisation is
 * held for the length of an engagement, and re-asking every four hours would make
 * the control an obstacle people route around rather than one they use. Thirty
 * days is long enough to cover a support relationship and short enough that a
 * customer who left is not still being watched a quarter later.
 *
 * Still bounded, and that is the point that must not be lost: no path anywhere
 * creates a workspace authorisation that does not expire.
 */
export const DEFAULT_READ_GRANT_MINUTES = 60 * 24 * 7;
export const MAX_READ_GRANT_MINUTES = 60 * 24 * 30;

/**
 * And for coverage of every workspace at once, shorter than a single-workspace
 * authorisation rather than longer.
 *
 * The instinct is the reverse — coverage feels like a standing arrangement — and
 * that instinct is what turns "explicit grant" back into a role. Seven days is a
 * fortnight's on-call rotation's worth of asking again.
 */
export const DEFAULT_COVERAGE_MINUTES = 60 * 24;
export const MAX_COVERAGE_MINUTES = 60 * 24 * 7;

/**
 * The standing CRM monitoring authorisation, and why its clock is different.
 *
 * OPERATIONAL coverage is short because it describes an incident. This one
 * describes a job: one named identity watches the CRM of every workspace as an
 * ongoing responsibility, and asking again every week would make the control an
 * obstacle rather than one anybody uses — which is the failure mode the comment
 * above warns about, arriving from the other direction.
 *
 * It is still bounded. A year is long enough to be a standing arrangement and
 * short enough that nobody is still being monitored by a person who left. There
 * is deliberately no unlimited option: the rule that no authorisation escapes an
 * expiry is the one thing here that must not acquire an exception.
 */
export const DEFAULT_CRM_MONITORING_MINUTES = 60 * 24 * 90;
export const MAX_CRM_MONITORING_MINUTES = 60 * 24 * 365;

/** Which ceiling and default a coverage kind gets. */
export function coverageWindow(kind: CoverageKind): { fallback: number; ceiling: number } {
  return kind === 'CRM_MONITORING'
    ? { fallback: DEFAULT_CRM_MONITORING_MINUTES, ceiling: MAX_CRM_MONITORING_MINUTES }
    : { fallback: DEFAULT_COVERAGE_MINUTES, ceiling: MAX_COVERAGE_MINUTES };
}

/**
 * Long enough to be a sentence. "fix" is not a reason; it is a word.
 *
 * Exported so the console can refuse the same input the API refuses, and say so
 * before the round trip rather than after. Two copies of this number would drift
 * into a form that accepts what the server rejects.
 */
export const MIN_REASON = 12;

export type GrantKind = 'READ' | 'WRITE';

export interface AccessGrant {
  id: string;
  tenantId: string;
  kind: GrantKind;
  reason: string;
  grantedAt: Date;
  expiresAt: Date;
}

/**
 * The caller's live grant of this kind for this workspace, or null.
 *
 * `revokedAt: null` and `expiresAt > now`, both checked in the query so a
 * revoked-and-expired grant cannot be resurrected by a clock skew on one side.
 *
 * `kind` defaults to WRITE because that is what every caller wanted when this
 * function had no kind at all, and getting it wrong in that direction would hand
 * somebody write access on the strength of a read grant. A caller that means
 * "may this person be in this workspace" asks `mayEnterWorkspace` below, which
 * also weighs coverage, rather than asking for a READ grant directly.
 */
export async function activeGrant(
  platformUserId: string,
  tenantId: string,
  kind: GrantKind = 'WRITE',
): Promise<AccessGrant | null> {
  const grant = await prisma.platformAccessGrant.findFirst({
    where: { platformUserId, tenantId, kind, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: 'desc' },
    select: { id: true, tenantId: true, kind: true, reason: true, grantedAt: true, expiresAt: true },
  });
  return grant;
}

/**
 * Live coverage of every workspace, for this person, or null.
 *
 * Deliberately not folded into `activeGrant`: coverage names no workspace, so a
 * function whose whole signature is "(person, workspace)" cannot express it, and
 * making `tenantId` optional there would turn one clear question into two
 * unclear ones.
 */
export async function activeCoverage(platformUserId: string): Promise<CoverageGrant | null> {
  return prisma.platformCoverageGrant.findFirst({
    where: { platformUserId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: 'desc' },
    select: { id: true, kind: true, reason: true, grantedAt: true, expiresAt: true, sensitive: true },
  });
}

/**
 * The standing platform-wide CRM monitoring entitlement, if this identity holds
 * a live one.
 *
 * Asked by the monitoring directory to decide whether it lists every ACTIVE
 * workspace or only the ones named in per-workspace grants. Deliberately a
 * separate question from `activeCoverage`: an OPERATIONAL coverage grant also
 * admits its holder everywhere, but it is an incident measure, and a directory
 * that cannot tell the two apart cannot explain to the reader which one they
 * are relying on or when it ends.
 *
 * Evaluated on read, like every other grant here, so a revocation takes effect
 * on the next request rather than when a session happens to expire.
 */
export async function activeCrmMonitoring(platformUserId: string): Promise<CoverageGrant | null> {
  return prisma.platformCoverageGrant.findFirst({
    where: { platformUserId, kind: 'CRM_MONITORING', revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: 'desc' },
    select: { id: true, kind: true, reason: true, grantedAt: true, expiresAt: true, sensitive: true },
  });
}

export type CoverageKind = 'OPERATIONAL' | 'CRM_MONITORING';

export interface CoverageGrant {
  id: string;
  /**
   * Which kind of coverage this is. Optional on the type rather than required,
   * because `openCoverage` below returns the row it just wrote through the same
   * shape and selects the columns it always did; a caller that needs the kind
   * asks for it (`activeCoverage`, `activeCrmMonitoring`) and a caller that does
   * not is unchanged.
   */
  kind?: CoverageKind;
  reason: string;
  grantedAt: Date;
  expiresAt: Date;
  /** Recordings, transcripts and stored documents. Never implied by the kind. */
  sensitive?: boolean;
}

/**
 * May this member of platform staff be inside this workspace at all?
 *
 * The question `enter` asks before pointing a session at a tenant, and the one
 * `resolveCtx` asks again on every request afterwards — because an authorisation
 * checked only at the door is an authorisation that survives its own revocation
 * for as long as the session lives.
 *
 * Answered by a named workspace grant or by live coverage, in that order: the
 * specific one is cheaper, is the common case, and is the one an operator will
 * have created deliberately. Coverage is the exception and is looked up only when
 * the specific answer is no.
 *
 * A live break-glass (WRITE) grant also admits its holder, for its lifetime. It is
 * owner-only, reason-bound and time-boxed, and every read under it is labelled
 * mode=break-glass; without this a sole owner, who may not issue themselves a
 * monitoring grant, could never use it.
 */
export async function mayEnterWorkspace(
  platformUserId: string,
  tenantId: string,
  // Off unless the caller says otherwise: omitting it can never widen entry. A
  // monitoring session passes false, so a WRITE grant never admits it.
  options: { allowBreakGlass?: boolean } = {},
): Promise<boolean> {
  if (await activeGrant(platformUserId, tenantId, 'READ')) return true;
  if (options.allowBreakGlass && (await activeGrant(platformUserId, tenantId, 'WRITE'))) return true;
  return (await activeCoverage(platformUserId)) !== null;
}

/**
 * Every workspace this person may currently open.
 *
 * Returns `null` to mean "all of them", which the caller turns into an unfiltered
 * query. A list of every tenant id would be the same answer and would grow with
 * the customer count on a page that then has to filter by it; `null` says the
 * thing the coverage grant actually said.
 */
export async function authorizedTenantIds(platformUserId: string): Promise<string[] | null> {
  if (await activeCoverage(platformUserId)) return null;
  /**
   * `withPlatformTx`, for the same reason `liveGrantCount` below needs it and
   * `activeGrant` above does not.
   *
   * This is the one grant query that names no tenant — it is asking *which*
   * tenants, so it cannot pin one. PlatformAccessGrant is under row-level
   * security (20260826120000), and a query that sets no `app.tenant_id` does not
   * error against that policy: it quietly matches nothing. A staff member would
   * have signed in to be told they are authorised for no workspaces at all,
   * which reads as "access revoked" rather than as a bug, and is the failure this
   * whole table was put under a policy to make impossible in the other direction.
   */
  const grants = await withPlatformTx((tx) =>
    tx.platformAccessGrant.findMany({
      where: { platformUserId, kind: 'READ', revokedAt: null, expiresAt: { gt: new Date() } },
      select: { tenantId: true },
    }),
  );
  return [...new Set(grants.map((grant) => grant.tenantId))];
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
  kind?: GrantKind;
  /** Also covers recordings, transcripts and documents. Off unless asked for. */
  sensitive?: boolean;
  reason: string;
  minutes?: number;
  requestId?: string;
}): Promise<AccessGrant> {
  const kind = input.kind ?? 'WRITE';
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON) {
    throw Invalid([
      {
        field: 'reason',
        code: 'invalid',
        message:
          kind === 'WRITE'
            ? `Say why you need to change this customer's data — at least ${MIN_REASON} characters. It is written to the workspace's audit trail.`
            : `Say why this workspace needs to be monitored — at least ${MIN_REASON} characters. It is written to the workspace's audit trail.`,
      },
    ]);
  }

  const ceiling = kind === 'WRITE' ? MAX_GRANT_MINUTES : MAX_READ_GRANT_MINUTES;
  const fallback = kind === 'WRITE' ? DEFAULT_GRANT_MINUTES : DEFAULT_READ_GRANT_MINUTES;
  const minutes = Math.min(Math.max(Math.round(input.minutes ?? fallback), 1), ceiling);

  const existing = await activeGrant(input.platformUserId, input.tenantId, kind);
  if (existing) {
    throw Forbidden(
      kind === 'WRITE'
        ? `You already have write access to this workspace until ${existing.expiresAt.toISOString()}. ` +
            'Hand it back before opening another.'
        : `That person is already authorised for this workspace until ${existing.expiresAt.toISOString()}. ` +
            'Revoke it before issuing another.',
    );
  }

  const grant = await prisma.platformAccessGrant.create({
    data: {
      tenantId: input.tenantId,
      platformUserId: input.platformUserId,
      kind,
      // A WRITE grant reaches everything through buildSupportActor anyway, so
      // recording it as sensitive keeps the column an honest description of the
      // grant rather than a second gate that disagrees with the first.
      sensitive: input.sensitive ?? kind === 'WRITE',
      reason,
      expiresAt: new Date(Date.now() + minutes * 60_000),
      requestId: input.requestId ?? null,
    },
    select: { id: true, tenantId: true, kind: true, reason: true, grantedAt: true, expiresAt: true },
  });
  return grant;
}

/**
 * Hands it back early. Idempotent: closing what is already closed is not an error.
 *
 * `kind` is optional and omitting it closes both, which is what "revoke this
 * person's access to this workspace" means to whoever asks for it. A caller that
 * means only the elevation — the break-glass DELETE, which must not also strip
 * the authorisation to be there — names WRITE.
 */
export async function revokeGrants(platformUserId: string, tenantId: string, kind?: GrantKind): Promise<number> {
  const { count } = await prisma.platformAccessGrant.updateMany({
    where: { platformUserId, tenantId, revokedAt: null, ...(kind ? { kind } : {}) },
    data: { revokedAt: new Date() },
  });
  return count;
}

/**
 * Opens coverage of every workspace for one person.
 *
 * Refuses a self-grant. Every other control here is about making authority
 * visible and bounded; one person being able to award themselves sight of every
 * customer would leave a perfect audit trail of an act nobody approved. The
 * caller is the platform owner and the subject is whoever they name, and those
 * must be two people.
 */
export async function openCoverage(input: {
  platformUserId: string;
  grantedById: string;
  sensitive?: boolean;
  reason: string;
  minutes?: number;
  requestId?: string;
}): Promise<CoverageGrant> {
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON) {
    throw Invalid([
      {
        field: 'reason',
        code: 'invalid',
        message: `Say why this person needs every workspace — at least ${MIN_REASON} characters.`,
      },
    ]);
  }
  if (input.platformUserId === input.grantedById) {
    throw Forbidden('Coverage of every workspace has to be granted by somebody else.');
  }

  const existing = await activeCoverage(input.platformUserId);
  if (existing) {
    throw Forbidden(
      `That person already has coverage until ${existing.expiresAt.toISOString()}. Revoke it before issuing another.`,
    );
  }

  const minutes = Math.min(Math.max(Math.round(input.minutes ?? DEFAULT_COVERAGE_MINUTES), 1), MAX_COVERAGE_MINUTES);
  return prisma.platformCoverageGrant.create({
    data: {
      platformUserId: input.platformUserId,
      grantedById: input.grantedById,
      sensitive: input.sensitive ?? false,
      reason,
      expiresAt: new Date(Date.now() + minutes * 60_000),
      requestId: input.requestId ?? null,
    },
    select: { id: true, reason: true, grantedAt: true, expiresAt: true },
  });
}

/** Ends it now. Idempotent, like its per-workspace sibling. */
export async function revokeCoverage(platformUserId: string, reason: string): Promise<number> {
  const { count } = await prisma.platformCoverageGrant.updateMany({
    where: { platformUserId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
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
