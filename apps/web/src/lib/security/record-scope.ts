import { prisma, type TxClient } from '@/lib/db';
import { AppError, NotFound } from '@/lib/errors';
import { atLeast, can, type Action, type Ctx } from '@/lib/security/rbac';
import { assertRecordVisible } from '@/lib/security/visibility';

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
  if (atLeast(ctx, 'calls', action, 'TEAM')) return;
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
  if (atLeast(ctx, 'events', action, 'TEAM')) return;
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

/**
 * The lead a record is being hung on, in the caller's scope under the lead's
 * own rule: `EDIT` where the route is lead work (a task, a follow-up), `VIEW`
 * where the record is another module's and the lead is its client. A body's
 * `leadId` was otherwise the whole check — an agent at OWN scope could put a
 * call, visit or sale on any lead in the workspace and read its name back on
 * their own screens. Not found either way. Inside `withTx`, pass its `tx`.
 */
export async function assertLeadInScope(ctx: Ctx, leadId: string, db: TxClient | typeof prisma, action: Action) {
  const lead = await db.lead.findFirst({
    where: { tenantId: ctx.tenantId, id: leadId, deletedAt: null },
    select: { tenantId: true, ownerId: true },
  });
  if (!lead) throw NotFound('Lead');
  try {
    await assertRecordVisible(ctx, 'leads', lead, db, action);
  } catch (err) {
    if (err instanceof AppError && err.status === 403) throw NotFound('Lead');
    throw err;
  }
}

/**
 * `assertLeadInScope` at `VIEW`, or a lead on a calling queue. Who the dialer
 * rings is the campaign's decision, whoever owns the lead (services/dialer/queue.ts),
 * and `dialer:VIEW` already lists the queue — so the call, and the visit,
 * requirement or shortlist booked from it, may name a lead outside the
 * caller's own scope.
 */
export async function assertLeadCallable(ctx: Ctx, leadId: string) {
  try {
    await assertLeadInScope(ctx, leadId, prisma, 'VIEW');
  } catch (err) {
    if (!(err instanceof AppError && err.status === 404) || !can(ctx, 'dialer', 'VIEW')) throw err;
    const queued = await prisma.campaignContact.findFirst({
      where: { tenantId: ctx.tenantId, leadId },
      select: { id: true },
    });
    if (!queued) throw err;
  }
}

/** True when the caller sees every record of this kind in the workspace. */
export function seesWholeWorkspace(ctx: Ctx, module: string, action: Action = 'VIEW'): boolean {
  return atLeast(ctx, module, action, 'TEAM');
}
