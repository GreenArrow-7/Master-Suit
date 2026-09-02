import { prisma } from '@/lib/db';
import { Forbidden, NotFound } from '@/lib/errors';
import { scopeFor, type Ctx } from '@/lib/security/rbac';
import { resolveOwnerIds } from '@/lib/security/visibility';

/**
 * Record visibility for events.
 *
 * ── Why events do not simply reuse the call rule ────────────────────────────
 *
 * `GET /api/v1/events` filtered on `tenantId` alone, so `events:VIEW` at OWN saw
 * every event in the company — the same hole the call detail routes had. But
 * events cannot be closed the same way, because unlike a call they are shared
 * objects by nature:
 *
 *   * an all-hands or an office closure is *meant* to be seen by everyone, and
 *   * somebody invited to an event must be able to see it, even when the host
 *     sits outside their scope.
 *
 * Applying owner scope alone would have hidden the company calendar from the
 * company. So there are three ways to see an event, and only three:
 *
 *   1. it is an explicit `ORGANIZATION` event — the company-wide announcement;
 *   2. its host (or, hostless, its creator) is inside your permission scope;
 *   3. you are personally on its invitee list.
 *
 * ── The invitee exemption is VIEW-only ──────────────────────────────────────
 *
 * Being invited to something is not authority over it. The exemption appears in
 * `eventVisibilityWhere` and `requireVisibleEvent` and deliberately *not* in
 * `requireMutableEvent`, so an invitee can read the event they are attending and
 * still cannot edit it, delete it, add or remove other invitees, change the
 * host, or record RSVPs for other people. Every mutation continues to need the
 * RBAC action *and* scope over the record, exactly as before.
 */

/** The owner of an event: whoever is hosting it, or whoever created it. */
function ownedBy(ids: readonly string[]) {
  return [
    { hostId: { in: ids as string[] } },
    // Hostless events fall back to their creator, so an event nobody was named
    // to host is still owned by somebody rather than by no one.
    { AND: [{ hostId: null }, { createdById: { in: ids as string[] } }] },
  ];
}

/**
 * The `where` fragment for any event list.
 *
 * Returns a fragment rather than performing the query so callers keep their own
 * filters, ordering and includes — the list route adds status and campaign
 * filters on top of this.
 */
export async function eventVisibilityWhere(ctx: Ctx): Promise<Record<string, unknown>> {
  const scope = scopeFor(ctx, 'events', 'VIEW');
  if (scope === 'NONE') throw Forbidden();

  const base = { tenantId: ctx.tenantId, deletedAt: null };
  if (scope === 'ORGANIZATION') return base;

  const ownerIds = await resolveOwnerIds(ctx, scope);
  return {
    ...base,
    OR: [
      // 1. Explicitly company-wide.
      { visibility: 'ORGANIZATION' as const },
      // 2. Owned by someone inside the viewer's scope.
      ...ownedBy(ownerIds),
      // 3. The viewer is personally invited.
      { invitees: { some: { userId: ctx.actor.id, tenantId: ctx.tenantId } } },
    ],
  };
}

/**
 * One event the viewer may READ, including via the invitee exemption.
 *
 * `NotFound` rather than `Forbidden`: an event the viewer has no relationship to
 * should not be confirmed to exist, and the id is the only thing they supplied.
 */
export async function requireVisibleEvent(ctx: Ctx, eventId: string) {
  const where = await eventVisibilityWhere(ctx);
  const event = await prisma.event.findFirst({
    where: { ...where, id: eventId },
    select: { id: true, hostId: true, createdById: true, visibility: true },
  });
  if (!event) throw NotFound('Event');
  return event;
}

/**
 * One event the viewer may CHANGE.
 *
 * No invitee exemption and no ORGANIZATION exemption: a company-wide
 * announcement is readable by everyone and editable only by people with scope
 * over its host. Otherwise publishing an event to the company would hand the
 * company permission to rewrite it.
 */
export async function requireMutableEvent(ctx: Ctx, eventId: string, action: 'EDIT' | 'DELETE' = 'EDIT') {
  const event = await prisma.event.findFirst({
    where: { id: eventId, tenantId: ctx.tenantId, deletedAt: null },
    select: { id: true, hostId: true, createdById: true, visibility: true },
  });
  if (!event) throw NotFound('Event');

  const scope = scopeFor(ctx, 'events', action);
  if (scope === 'NONE') throw Forbidden();
  if (scope === 'ORGANIZATION') return event;

  const owner = event.hostId ?? event.createdById;
  if (owner && owner === ctx.actor.id) return event;

  const ownerIds = await resolveOwnerIds(ctx, scope);
  if (!owner || !ownerIds.includes(owner)) throw Forbidden();
  return event;
}
