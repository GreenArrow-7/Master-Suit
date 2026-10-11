import { prisma, type TxClient } from '@/lib/db';
import { AppError, NotFound } from '@/lib/errors';
import { atLeast, can, scopeFor, type Action, type Ctx } from '@/lib/security/rbac';
import { assertRecordVisible, resolveOwnerIds, visibilityWhere } from '@/lib/security/visibility';

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
 * host it or created it, and an invitee may see the event they were invited to.
 * Read only: at any other action the invitee clause drops out. The action is
 * the route's own and has no default: a VIEW default let PATCH, DELETE, invite
 * and RSVP reach an event its caller was only invited to.
 */
export async function assertEventInScope(ctx: Ctx, eventId: string, action: Action): Promise<void> {
  if (atLeast(ctx, 'events', action, 'TEAM')) return;
  const visible = await prisma.event.findFirst({
    where: { id: eventId, tenantId: ctx.tenantId, deletedAt: null, ...eventScopeFilter(ctx.actor.id, action) },
    select: { id: true },
  });
  if (!visible) throw NotFound('Event');
}

/** The same rule as a `where` fragment, for the list route. */
export function eventScopeFilter(actorId: string, action: Action = 'VIEW') {
  const mine = [{ hostId: actorId }, { createdById: actorId }];
  return { OR: action === 'VIEW' ? [...mine, { invitees: { some: { userId: actorId } } }] : mine };
}

/**
 * What every read of events adds to its `where`: nothing at TEAM scope and
 * above, `eventScopeFilter` below it. The list route had it; the Events page,
 * an event's page, the calendar and the assistant read every event in the
 * workspace.
 */
export function eventListScope(ctx: Ctx) {
  return seesWholeWorkspace(ctx, 'events') ? {} : eventScopeFilter(ctx.actor.id);
}

/**
 * The lead a record is being hung on, in the caller's scope under the lead's
 * own rule: `EDIT` where the route is lead work (a task, a follow-up), `VIEW`
 * where the record is another module's and the lead is its client. A body's
 * `leadId` was otherwise the whole check — an agent at OWN scope could put a
 * call, visit or sale on any lead in the workspace and read its name back on
 * their own screens. Not found either way. Inside `withTx`, pass its `tx`.
 * Returns the row for callers that go on to edit it: the lead's own by-id
 * writes (PATCH, DELETE, close-out, phones, temperature) load through here
 * too, so an out-of-scope id answers the same 404 as GET instead of a 403
 * that confirmed the lead exists.
 */
export async function assertLeadInScope(ctx: Ctx, leadId: string, db: TxClient | typeof prisma, action: Action) {
  const lead = await db.lead.findFirst({ where: { tenantId: ctx.tenantId, id: leadId, deletedAt: null } });
  if (!lead) throw NotFound('Lead');
  await assertRecordInScope(ctx, 'leads', lead, db, action, 'Lead');
  return lead;
}

/**
 * `assertRecordVisible` for a record a route loaded by id: out of scope answers
 * the same 404 as a missing id (`label` names it), never a 403. Inside
 * `withTx`, pass its `tx`.
 */
export async function assertRecordInScope(
  ctx: Ctx,
  module: string,
  record: Parameters<typeof assertRecordVisible>[2],
  db: TxClient | typeof prisma,
  action: Action,
  label: string,
) {
  try {
    await assertRecordVisible(ctx, module, record, db, action);
  } catch (err) {
    if (err instanceof AppError && err.status === 403) throw NotFound(label);
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

/**
 * The contact a record names, as its own page shows it (`GET /contacts/{id}`):
 * the contacts list's rule, under which an unassigned contact is only for
 * those who may claim it. A call's follow-up email reads its contact's name
 * and address, a visit's page its name and number, and a contact has one
 * referral code, open testimonial ask and client profile — a body's
 * `contactId` was otherwise checked against the workspace at most. Not found
 * either way. Reads through the global client, so call it outside `withTx`.
 */
export async function assertContactInScope(ctx: Ctx, contactId: string) {
  const contact =
    can(ctx, 'contacts', 'VIEW') &&
    (await prisma.contact.findFirst({
      where: {
        ...(await visibilityWhere(ctx, 'contacts', 'VIEW', { includeUnassigned: true })),
        id: contactId,
        deletedAt: null,
      },
      select: { id: true },
    }));
  if (!contact) throw NotFound('Contact');
}

/**
 * A task or follow-up by id: yours, or owned by someone your `module` scope for
 * `action` covers. `tasks/{id}` checked nothing about the task, so `leads:EDIT`
 * changed, completed or took any task in the workspace, and `tasks:DELETE`
 * deleted it; `follow-ups/{id}` treated TEAM scope as the whole workspace. A
 * record with no owner is listed only at ORGANIZATION scope, so only that
 * reaches one here — `assertRecordVisible` would pass it for anyone. Not found
 * either way.
 */
export async function assertOwnerInScope(
  ctx: Ctx,
  tx: TxClient,
  module: string,
  action: Action,
  ownerId: string | null,
  what: string,
) {
  if (ownerId === ctx.actor.id) return;
  const scope = scopeFor(ctx, module, action);
  if (scope === 'ORGANIZATION') return;
  if (scope === 'NONE' || !ownerId || !(await resolveOwnerIds(ctx, scope, tx)).includes(ownerId)) {
    throw NotFound(what);
  }
}

/** True when the caller sees every record of this kind in the workspace. */
export function seesWholeWorkspace(ctx: Ctx, module: string, action: Action = 'VIEW'): boolean {
  return atLeast(ctx, module, action, 'TEAM');
}
