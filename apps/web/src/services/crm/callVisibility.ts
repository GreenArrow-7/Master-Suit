import { prisma } from '@/lib/db';
import { Forbidden, NotFound } from '@/lib/errors';
import { scopeFor, SCOPE_RANK, type Ctx } from '@/lib/security/rbac';
import { resolveOwnerIds } from '@/lib/security/visibility';

/**
 * Record-level visibility for one call, and everything hanging off it.
 *
 * ── The hole this closes ────────────────────────────────────────────────────
 *
 * `GET /api/v1/calls` scopes its list: below TEAM it filters `callerId` to the
 * viewer. Every *detail* route under `/api/v1/calls/[id]/…` looked the call up
 * with `{ id, tenantId, deletedAt: null }` and nothing else — so the scope that
 * governs the list stopped at the list.
 *
 * A representative holding `calls:VIEW` at OWN could therefore read any
 * colleague's call in the same workspace by id: the transcript, the AI analysis,
 * the consent record, the coaching notes, and the recording audio itself. The
 * id is a cuid, but it is not a secret — it appears in the caller's own list
 * responses, in exports and in notification payloads.
 *
 * The rule was already implemented correctly in exactly one place, the coaching
 * route. This is that implementation, moved somewhere the other fifteen routes
 * can reach it rather than reimplemented per route — which is how it came to
 * exist in one route out of sixteen in the first place.
 *
 * ── Why Forbidden and not NotFound ──────────────────────────────────────────
 *
 * The caller is inside the right tenant and does hold `calls:VIEW`; what they
 * lack is reach over this particular record. That is an authorisation answer,
 * and it is the answer the coaching route has always given. Cross-*tenant*
 * access is a different question and is still answered with NotFound by the
 * tenant guard above this, which never lets another workspace's row load at all.
 */
export async function requireVisibleCall(ctx: Ctx, callId: string) {
  const call = await prisma.call.findFirst({
    where: { id: callId, tenantId: ctx.tenantId, deletedAt: null },
    select: { id: true, callerId: true },
  });
  if (!call) throw NotFound('Call');
  await assertCallInScope(ctx, call);
  return call;
}

/**
 * The scope test on a call already in hand.
 *
 * Separate so a route that must load the full row for its own reasons does not
 * pay for a second query just to authorise it.
 */
export async function assertCallInScope(ctx: Ctx, call: { callerId: string | null }) {
  const scope = scopeFor(ctx, 'calls', 'VIEW');
  // Your own call is always yours to see, whatever the scope.
  if (call.callerId === ctx.actor.id || scope === 'ORGANIZATION') return;
  if (SCOPE_RANK[scope] < SCOPE_RANK.TEAM) throw Forbidden();
  const ids = await resolveOwnerIds(ctx, scope);
  // An unassigned call is nobody's to read below ORGANIZATION.
  if (!call.callerId || !ids.includes(call.callerId)) throw Forbidden();
}
