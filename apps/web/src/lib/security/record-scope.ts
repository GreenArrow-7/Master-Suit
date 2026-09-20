import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { scopeFor, SCOPE_RANK, type Action, type Ctx } from '@/lib/security/rbac';

/**
 * Record scope for the routes that load one record by id.
 *
 * A list route filters what it returns; a detail route that loads by id alone
 * returns whatever the id names. Where both exist for the same records, the
 * detail route has to apply the same rule, or the id is the whole access
 * control. That was the defect these guards close: `/api/v1/calls/{id}` and its
 * sub-routes (transcript, analysis, consent, recording and the audio stream)
 * loaded by `{ id, tenantId }` only, so a seller holding `calls:VIEW` at OWN
 * scope could read a colleague's call, its transcript and its recording by
 * quoting the id — while the list route beside them already refused to name it.
 *
 * Both helpers are guards: they answer nothing and change no response for a
 * caller who is entitled to the record. Below TEAM scope they cost one indexed
 * lookup; at TEAM scope and above they cost nothing, matching the list rule
 * exactly (`SCOPE_RANK[scope] < SCOPE_RANK.TEAM` → own records only).
 *
 * `NotFound`, not `Forbidden`: a refusal that distinguishes "not yours" from
 * "does not exist" tells a caller which ids are real.
 */
export async function assertCallInScope(ctx: Ctx, callId: string, action: Action = 'VIEW'): Promise<void> {
  if (SCOPE_RANK[scopeFor(ctx, 'calls', action)] >= SCOPE_RANK.TEAM) return;
  const own = await prisma.call.findFirst({
    where: { id: callId, tenantId: ctx.tenantId, deletedAt: null, callerId: ctx.actor.id },
    select: { id: true },
  });
  if (!own) throw NotFound('Call');
}

/**
 * The event equivalent. An event has no visibility column, so below TEAM scope
 * the rule is the one the records themselves carry: the event is yours when you
 * host it or created it, and an invitee may see the event they were invited to
 * (read only — the write routes keep their own checks).
 */
export async function assertEventInScope(ctx: Ctx, eventId: string, action: Action = 'VIEW'): Promise<void> {
  if (SCOPE_RANK[scopeFor(ctx, 'events', action)] >= SCOPE_RANK.TEAM) return;
  const visible = await prisma.event.findFirst({
    where: { id: eventId, tenantId: ctx.tenantId, deletedAt: null, ...eventScopeFilter(ctx.actor.id) },
    select: { id: true },
  });
  if (!visible) throw NotFound('Event');
}

/** The same rule as a `where` fragment, for the list route. */
export function eventScopeFilter(actorId: string) {
  return {
    OR: [{ hostId: actorId }, { createdById: actorId }, { invitees: { some: { userId: actorId } } }],
  };
}

/** True when the caller sees every record of this kind in the workspace. */
export function seesWholeWorkspace(ctx: Ctx, module: string, action: Action = 'VIEW'): boolean {
  return SCOPE_RANK[scopeFor(ctx, module, action)] >= SCOPE_RANK.TEAM;
}
