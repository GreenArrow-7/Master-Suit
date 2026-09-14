import { prisma } from '../db';
import { Forbidden } from '../errors';
import type { Ctx } from '../security/rbac';
import { platformUserIdOf } from './support-actor';

/**
 * The gate on a customer's conversations and stored documents, for platform
 * staff only.
 *
 * ── Why this is not a permission ────────────────────────────────────────────
 *
 * A recording, a transcript and a lead's attachments are reached today through
 * `calls:VIEW` and `documents:VIEW`, the same permissions that list the calls and
 * the documents. Splitting them into new modules would work and would change
 * every *customer's* role at the same time — an account executive who can see the
 * call list would stop being able to play the call until somebody re-granted it,
 * across every workspace, to fix a platform-access question they have no part in.
 *
 * The asymmetry is the point: a member of the customer's staff listening to their
 * own company's call is ordinary work. A member of *our* staff doing it is a
 * different act and is the one that needs asking for. So this narrows platform
 * identities and leaves workspace roles exactly as they are.
 *
 * ── What it checks ──────────────────────────────────────────────────────────
 *
 * The live grant that authorised this person into this workspace must carry
 * `sensitive`. Per request, like every other authorisation here: a grant edited
 * or revoked mid-session stops working on the next call and not at the next
 * sign-in.
 *
 * Break-glass passes because `buildSupportActor` already gives a live WRITE grant
 * every permission there is — a gate here that disagreed with that would be
 * decoration. The migration marks those rows `sensitive` so the column describes
 * what the grant actually confers.
 */
/**
 * The decision as a yes/no, for a page that still renders a call's metadata to
 * a monitoring identity and withholds only the conversation.
 */
export async function hasSensitiveAccess(ctx: Ctx): Promise<boolean> {
  const platformUserId = ctx.service?.platformUserId ?? platformUserIdOf(ctx.actor.id);
  // One of the customer's own people. Their role already decided this.
  if (!platformUserId) return true;

  /**
   * A machine identity is decided by its credential's scopes, which are minted
   * one at a time by an owner and validated at mint time — that is already an
   * explicit, separate authorisation, and it is the object this check would
   * otherwise duplicate. `buildSupportActor` has narrowed the permission map to
   * those scopes before the route's own permission check ran, so a credential
   * without `calls:read` never reaches here at all.
   */
  if (ctx.service) return true;

  const now = new Date();
  const [grant, coverage] = await Promise.all([
    prisma.platformAccessGrant.findFirst({
      where: {
        platformUserId,
        tenantId: ctx.tenantId,
        revokedAt: null,
        expiresAt: { gt: now },
        sensitive: true,
        // A break-glass WRITE grant is sensitive by construction, and it answers
        // only for a session actually running under it. A monitoring session —
        // including one whose identity holds a live WRITE grant — needs a READ
        // grant that was issued with the sensitive flag.
        ...(ctx.actor.platformMode === 'break-glass' ? {} : { kind: 'READ' as const }),
      },
      select: { id: true },
    }),
    prisma.platformCoverageGrant.findFirst({
      where: { platformUserId, revokedAt: null, expiresAt: { gt: now }, sensitive: true },
      select: { id: true },
    }),
  ]);

  return Boolean(grant || coverage);
}

export async function assertSensitiveAccess(ctx: Ctx, what: string): Promise<void> {
  if (!(await hasSensitiveAccess(ctx))) {
    throw Forbidden(
      `Monitoring access to this workspace does not include ${what}. ` +
        'It is granted separately, and the grant records who asked and why.',
    );
  }
}
