import { prisma, type TxClient } from '@/lib/db';
import { AppError, NotFound } from '@/lib/errors';
import { atLeast, can, scopeFor, type Action, type Ctx } from '@/lib/security/rbac';
import {
  assertRecordVisible,
  resolveOwnerIds,
  visibilityWhere,
  type VisibilityOptions,
} from '@/lib/security/visibility';

/**
 * The calls a caller may reach for `action`, as a `where`: a call is its
 * caller's (`callerId`), read as the Calls page reads them. With no grant for
 * the action, your own calls (a follow-up names its call under `leads`).
 *
 * Calls and events follow one rule in their lists and by id: a detail route
 * that loads by id alone returns whatever the id names, so it applies its
 * list's rule or the id is the whole access control. TEAM, BRANCH and REGION
 * are the caller's resolved owners (`resolveOwnerIds`), not the workspace:
 * these guards used to return early from TEAM up, so a team manager read and
 * changed every call and event in the workspace by id. ORGANIZATION sees all.
 * `NotFound`, not `Forbidden`: a refusal that distinguishes "not yours" from
 * "does not exist" tells a caller which ids are real.
 */
export function callScope(ctx: Ctx, action: Action): Promise<Record<string, unknown>> {
  return can(ctx, 'calls', action)
    ? visibilityWhere(ctx, 'calls', action, { ownerField: 'callerId' })
    : Promise.resolve({ tenantId: ctx.tenantId, callerId: ctx.actor.id });
}

/**
 * A call by id under `callScope` for the route's own action (no default: a VIEW
 * default let a write reach a call its caller may only read), returned for the
 * route to use.
 */
export async function assertCallInScope(ctx: Ctx, callId: string, action: Action) {
  const call = await prisma.call.findFirst({
    where: { ...(await callScope(ctx, action)), id: callId, deletedAt: null },
  });
  if (!call) throw NotFound('Call');
  return call;
}

/**
 * The events a caller may reach for `action`, as a `where` fragment without
 * `tenantId`, which every read of events adds (the API, the Events page, an
 * event's page, the calendar, the assistant). An event has no visibility
 * column: it is its host's or its creator's, and an invitee reads the event
 * they were invited to (VIEW only). With no grant for the action, your own.
 */
export async function eventListScope(ctx: Ctx, action: Action = 'VIEW') {
  const scope = scopeFor(ctx, 'events', action);
  if (scope === 'ORGANIZATION') return {};
  const owners = scope === 'NONE' ? [ctx.actor.id] : await resolveOwnerIds(ctx, scope);
  const owned = [{ hostId: { in: owners } }, { createdById: { in: owners } }];
  return { OR: action === 'VIEW' ? [...owned, { invitees: { some: { userId: ctx.actor.id } } }] : owned };
}

/**
 * An event by id under `eventListScope`. The action is the route's own and has
 * no default: a VIEW default let PATCH, DELETE, invite and RSVP reach an event
 * its caller was only invited to.
 */
export async function assertEventInScope(ctx: Ctx, eventId: string, action: Action): Promise<void> {
  const visible = await prisma.event.findFirst({
    where: { id: eventId, tenantId: ctx.tenantId, deletedAt: null, ...(await eventListScope(ctx, action)) },
    select: { id: true },
  });
  if (!visible) throw NotFound('Event');
}

/**
 * Who may be handed work: an ACTIVE, undeleted account whose workspace access
 * is active too. The platform console suspends a membership and leaves the
 * workspace User ACTIVE, and that person cannot sign in either. An account with
 * no membership row is not blocked, as in `assessEligibility`.
 */
const activeMemberWhere = (tenantId: string) => ({
  tenantId,
  deletedAt: null,
  status: 'ACTIVE' as const,
  NOT: { workspaceMembership: { is: { status: { not: 'ACTIVE' as const } } } },
});

/**
 * The people this caller may hand work to, as a `where` on User: active
 * members inside their scope for `module:action` (the module's ASSIGN where
 * it has one). ORGANIZATION is any active member; TEAM, BRANCH and REGION the
 * resolved owners; OWN, or no grant, only yourself. From TEAM up the routes
 * took any active user in the workspace, and some took anyone. The reach sits
 * under `AND`, so a caller may add its own `id`. The routes that name a new
 * owner check it and the pickers list it, so no screen offers someone the API
 * refuses. Inside `withTx`, pass its `tx`.
 */
export async function assignableUserWhere(
  ctx: Ctx,
  module: string,
  action: Action,
  db: TxClient | typeof prisma = prisma,
) {
  const scope = scopeFor(ctx, module, action);
  if (scope === 'ORGANIZATION') return activeMemberWhere(ctx.tenantId);
  const reach = scope === 'NONE' ? [ctx.actor.id] : await resolveOwnerIds(ctx, scope, db);
  return { ...activeMemberWhere(ctx.tenantId), AND: [{ id: { in: reach } }] };
}

/** One user under `assignableUserWhere`: outside it answers 404, as an unknown user does. */
export async function assertAssignableUser(
  ctx: Ctx,
  db: TxClient | typeof prisma,
  module: string,
  action: Action,
  userId: string,
) {
  const user = await db.user.findFirst({
    where: { ...(await assignableUserWhere(ctx, module, action, db)), id: userId },
    select: { id: true },
  });
  if (!user) throw NotFound('User');
}

/** A picker's people: `assignableUserWhere`, by name. */
export async function assignableUsers(ctx: Ctx, module: string, action: Action) {
  return prisma.user.findMany({
    where: await assignableUserWhere(ctx, module, action),
    select: { id: true, fullName: true },
    orderBy: { fullName: 'asc' },
  });
}

/**
 * Targets are set, changed and deleted for the people the caller may hand lead
 * work to (`leads:ASSIGN`), and below ORGANIZATION never for themselves: a
 * team lead who could lower, replace or delete their own daily target would
 * walk past the check-out gate it feeds, as no one decides their own
 * attendance exception. Out of reach answers 404, as an unknown id does.
 */
const setsOwnTarget = (ctx: Ctx) => atLeast(ctx, 'leads', 'ASSIGN', 'ORGANIZATION');

/** The targets the caller may change or delete, as a `where` on EmployeeTarget. */
export async function targetReach(ctx: Ctx): Promise<Record<string, unknown>> {
  const where = await visibilityWhere(ctx, 'leads', 'ASSIGN', { ownerField: 'userId' });
  return setsOwnTarget(ctx) ? where : { ...where, userId: { not: ctx.actor.id } };
}

/** The people the caller may set a target for: the target picker and the board's Set target. */
export async function targetAssignees(ctx: Ctx) {
  const users = await assignableUsers(ctx, 'leads', 'ASSIGN');
  return setsOwnTarget(ctx) ? users : users.filter((user) => user.id !== ctx.actor.id);
}

/** One person under `targetAssignees`; anyone else answers 404. */
export async function assertTargetAssignee(ctx: Ctx, userId: string) {
  if (userId === ctx.actor.id && !setsOwnTarget(ctx)) throw NotFound('User');
  await assertAssignableUser(ctx, prisma, 'leads', 'ASSIGN', userId);
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
  try {
    await assertRecordInScope(ctx, 'leads', lead, db, action, 'Lead');
  } catch (err) {
    // The secondary owner works the lead as its owner does (`leadScope`). Only
    // when one is named: with none, the check would read it as unassigned.
    if (!lead.secondaryOwnerId || !(err instanceof AppError && err.status === 404)) throw err;
    await assertRecordInScope(ctx, 'leads', lead, db, action, 'Lead', 'secondaryOwnerId');
  }
  return lead;
}

/**
 * The leads a caller reaches for `action`, as a `where` on Lead: `visibilityWhere`
 * for `leads`, where the lead's secondary owner counts as its owner. Every read
 * of the Lead model goes through here rather than `visibilityWhere(ctx, 'leads')`,
 * which other lead work (follow-ups, cold data, social enquiries) applies to its
 * own rows, none of which has a second owner.
 */
export function leadScope(ctx: Ctx, action: Action = 'VIEW', opts: Omit<VisibilityOptions, 'ownerField'> = {}) {
  return visibilityWhere(ctx, 'leads', action, { ...opts, coOwnerFields: ['secondaryOwnerId'] });
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
  ownerField?: string,
) {
  try {
    await assertRecordVisible(ctx, module, record, db, action, ownerField);
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
 * A list of follow-ups (`leads`) or tasks (`tasks`): the caller's own when
 * `mine`, otherwise everyone their `module:VIEW` scope covers, as
 * `assertOwnerInScope` reaches them by id. TEAM, BRANCH and REGION are the
 * resolved owners, ORGANIZATION all, and a row with no owner only there. The
 * follow-ups list filtered on the caller alone, so a team lead saw none of the
 * team's.
 */
export function workListScope(ctx: Ctx, module: string, mine: boolean): Promise<Record<string, unknown>> {
  return mine
    ? Promise.resolve({ tenantId: ctx.tenantId, ownerId: ctx.actor.id })
    : visibilityWhere(ctx, module, 'VIEW');
}

/**
 * Whose rows `module:action` reaches, as `assertOwnerInScope` decides it, for a
 * list that shows a row's buttons only where its route takes them: some roles
 * read further than they edit or delete, and their buttons answered 404.
 */
export async function ownerReach(
  ctx: Ctx,
  module: string,
  action: Action,
): Promise<(ownerId: string | null) => boolean> {
  const scope = scopeFor(ctx, module, action);
  if (scope === 'ORGANIZATION') return () => true;
  const owners = new Set(scope === 'NONE' ? [] : await resolveOwnerIds(ctx, scope));
  return (ownerId: string | null) => ownerId !== null && owners.has(ownerId);
}

/**
 * The leads in `ids` the caller may open, by id, under the lead page's own rule.
 * A follow-up or task in scope can hang on a lead that has left it (a
 * reassignment moves only open work), and the lists showed that lead's name.
 */
export async function leadsInScope(ctx: Ctx, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const leads =
    wanted.length > 0 && scopeFor(ctx, 'leads', 'VIEW') !== 'NONE'
      ? await prisma.lead.findMany({
          where: { ...(await leadScope(ctx, 'VIEW', { includeUnassigned: true })), id: { in: wanted } },
          select: { id: true, fullName: true },
        })
      : [];
  return new Map(leads.map((lead) => [lead.id, lead]));
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
