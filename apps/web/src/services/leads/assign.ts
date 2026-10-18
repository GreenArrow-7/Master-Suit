import { prisma, type TxClient } from '@/lib/db';
import { Conflict, Forbidden, Invalid } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import { scopeFor, type Ctx } from '@/lib/security/rbac';
import { assertAssignableUser, assignableUserWhere, leadScope } from '@/lib/security/record-scope';
import { resolveOwnerIds } from '@/lib/security/visibility';
import { activeRule } from '@/services/distribution/assignLead';
import { openTriageEntry } from '@/services/distribution/triage';
import { notifyLeadMoves } from '@/services/crm/notify';
import { queueCalendarSync } from '@/services/integrations/googleCalendar';
import { OPEN_LEADS_WHERE } from './closeOut';
import { OPEN_STATUSES } from './nextFollowUp';

/**
 * Hands leads to one person, or to nobody: the writer behind bulk assignment
 * (POST /api/v1/leads/assign) and behind the hand-over below.
 *
 * Only the leads the caller's ASSIGN scope reaches move; an id outside it, or
 * one that does not exist, simply does not count. Writing history for every
 * requested id used to reassign across teams and 500 on an unknown id.
 *
 * The new owner must be an active member the caller's ASSIGN scope reaches
 * (`assertAssignableUser`), 404 otherwise. A suspended, removed or invited
 * account signs nobody in, so a lead handed to one sits where no colleague at
 * OWN scope sees it and the Allocation queue does not list it; and from TEAM up
 * any active user in the workspace was taken.
 *
 * The new owner and the previous one each get a bell row per lead, in the same
 * transaction (`notifyLeadMoves`; audit M17-05, M17-07). A lead already with
 * `ownerId` is left as it is: no hand-over recorded, its clock not restarted.
 *
 * Returns the ids that moved. Inside `withTx`, pass its `tx`.
 */
export async function assignLeads(
  ctx: Ctx,
  tx: TxClient,
  leadIds: string[],
  ownerId: string | null,
  reason: string,
): Promise<string[]> {
  if (ownerId) await assertAssignableUser(ctx, tx, 'leads', 'ASSIGN', ownerId);

  const scope = await leadScope(ctx, 'ASSIGN', { includeUnassigned: true, db: tx });
  const leads = (
    await tx.lead.findMany({
      where: { ...scope, id: { in: leadIds }, deletedAt: null },
      select: { id: true, ownerId: true, fullName: true },
    })
  ).filter((lead) => lead.ownerId !== ownerId);
  const ids = leads.map((lead) => lead.id);

  await tx.lead.updateMany({
    where: { id: { in: ids }, tenantId: ctx.tenantId },
    data: { ownerId, assignedAt: ownerId ? new Date() : null, updatedById: ctx.actor.id },
  });
  await tx.leadAssignmentHistory.createMany({
    data: leads.map((lead) => ({
      tenantId: ctx.tenantId,
      leadId: lead.id,
      fromOwnerId: lead.ownerId,
      toOwnerId: ownerId,
      assignedById: ctx.actor.id,
      reason,
    })),
  });
  await notifyLeadMoves(
    tx,
    ctx,
    leads.map((lead) => ({ id: lead.id, fullName: lead.fullName, from: lead.ownerId, to: ownerId })),
  );
  return ids;
}

/**
 * Whether the caller's leads:ASSIGN scope reaches `userId`. Every record a
 * hand-over moves is theirs, so this one check covers leads, follow-ups and
 * tasks — reassigning a follow-up or task is a `leads` permission too (the
 * follow-ups/[id] and tasks/[id] routes). Read before the account's row is
 * soft-deleted: a BRANCH or REGION reach lists users, and the tenant guard
 * hides deleted ones.
 */
export async function mayHandOverWorkOf(ctx: Ctx, userId: string, db: TxClient | typeof prisma = prisma) {
  const reach = scopeFor(ctx, 'leads', 'ASSIGN');
  if (reach === 'NONE') return false;
  return reach === 'ORGANIZATION' || (await resolveOwnerIds(ctx, reach, db)).includes(userId);
}

/** Open leads: an OPEN-category stage, not closed out — what bulk allocation would hand out. */
const openLeadsOf = (tenantId: string, ownerId: string) => ({
  tenantId,
  ownerId,
  deletedAt: null,
  stage: { is: { category: 'OPEN' as const } },
  AND: [OPEN_LEADS_WHERE],
});

/** Follow-ups and tasks not yet done — the same "open" the follow-up dates read. */
const openObligationsOf = (tenantId: string, ownerId: string) => ({
  tenantId,
  ownerId,
  deletedAt: null,
  status: { in: [...OPEN_STATUSES] },
});

export interface OpenWork {
  leads: number;
  followUps: number;
  tasks: number;
}

export async function countOpenWork(db: TxClient | typeof prisma, tenantId: string, userId: string): Promise<OpenWork> {
  // Sequential: inside a transaction every query shares one connection anyway.
  const leads = await db.lead.count({ where: openLeadsOf(tenantId, userId) });
  const followUps = await db.followUpTask.count({ where: openObligationsOf(tenantId, userId) });
  const tasks = await db.task.count({ where: openObligationsOf(tenantId, userId) });
  return { leads, followUps, tasks };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "3 open leads, 2 follow-ups and 1 task" — only the kinds there are. */
export function describeOpenWork(work: OpenWork): string {
  const parts = [
    work.leads && plural(work.leads, 'open lead'),
    work.followUps && plural(work.followUps, 'follow-up'),
    work.tasks && plural(work.tasks, 'task'),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? 'nothing');
}

/**
 * What a hand-over moved, plus the departing member's records a Google Calendar
 * event names them on as guest (M8-08): their open follow-ups and tasks, and the
 * open site visits they keep. `syncHandedOver` re-syncs them once it commits.
 */
export interface HandedOver extends OpenWork {
  calendar: { followUps: string[]; tasks: string[]; visits: string[] };
}

/**
 * After the hand-over's transaction commits: each event re-synced, so the new
 * owner is its guest and the leaver drops off (services/integrations/googleCalendar.ts
 * invites active owners only). Returns the counts the callers always answered with.
 */
export async function syncHandedOver(tenantId: string, handed: HandedOver | null): Promise<OpenWork | null> {
  if (!handed) return null;
  const { calendar, ...work } = handed;
  await queueCalendarSync(tenantId, 'followUp', ...calendar.followUps);
  await queueCalendarSync(tenantId, 'task', ...calendar.tasks);
  await queueCalendarSync(tenantId, 'visit', ...calendar.visits);
  return work;
}

export interface HandOver {
  /** The active member who takes the work — and the follow-ups and tasks even when the leads go to the queue. */
  toUserId?: string;
  /** Leave the leads unassigned and waiting in the Allocation queue instead. */
  leadsToQueue?: boolean;
}

/**
 * Hands a departing member's open work on, inside the transaction that suspends
 * or removes them, so the account is never left SUSPENDED holding work.
 *
 * Refuses (409, with the counts) while any is left and the request does not say
 * where it goes; the dialog in Admin > Users asks first, and an API caller gets
 * the same answer. Leads go to a member or back to the Allocation queue the way
 * an unplaced intake lead waits; follow-ups and tasks always need a member,
 * because the queue holds leads only.
 *
 * The caller's leads:ASSIGN scope must reach the departing member
 * (`mayHandOverWorkOf`), so an account administrator without it — the seeded
 * hr_admin and it_admin — cannot end an account that still holds work.
 *
 * Call after the account's status is written and before its `deletedAt` is:
 * User before Lead is the lock order assignment uses
 * (services/distribution/assignLead.ts), and the reach check cannot see a
 * soft-deleted user. Pass the result to `syncHandedOver` after the commit.
 */
export async function handOverOpenWork(
  ctx: Ctx,
  tx: TxClient,
  from: { id: string; fullName: string },
  handOver: HandOver,
  why: 'deactivated' | 'removed',
): Promise<HandedOver> {
  await endSecondOwnership(ctx, tx, from.id, why);
  const counts = await countOpenWork(tx, ctx.tenantId, from.id);
  const open = openObligationsOf(ctx.tenantId, from.id);
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
  const work: HandedOver = {
    ...counts,
    calendar: {
      followUps: ids(await tx.followUpTask.findMany({ where: open, select: { id: true } })),
      tasks: ids(await tx.task.findMany({ where: open, select: { id: true } })),
      visits: ids(
        await tx.siteVisit.findMany({
          where: { tenantId: ctx.tenantId, ownerId: from.id, status: { in: ['REQUESTED', 'APPROVED', 'CHECKED_IN'] } },
          select: { id: true },
        }),
      ),
    },
  };
  if (work.leads + work.followUps + work.tasks === 0) return work;

  const queue = handOver.leadsToQueue === true && work.leads > 0;
  const needsMember = (work.leads > 0 && !queue) || work.followUps + work.tasks > 0;
  if (needsMember && !handOver.toUserId) {
    throw Conflict(
      `${from.fullName} still owns ${describeOpenWork(work)}. Hand them to an active member` +
        `${work.leads ? ' (or send the leads to the allocation queue)' : ''} before this account is ${why}.`,
      { openWork: counts },
    );
  }

  if (!(await mayHandOverWorkOf(ctx, from.id, tx))) {
    throw Forbidden(`${from.fullName}'s work is outside what you may assign. Ask someone who can assign it.`);
  }

  // Someone the caller may hand work to (`assignableUserWhere`), as the dialog lists them.
  const to = handOver.toUserId
    ? await tx.user.findFirst({
        where: { ...(await assignableUserWhere(ctx, 'leads', 'ASSIGN', tx)), id: handOver.toUserId },
        select: { id: true },
      })
    : null;
  if (handOver.toUserId && (!to || to.id === from.id)) {
    throw Invalid([
      { field: 'handOverTo', code: 'not_found', message: 'Choose an active member to hand the work to.' },
    ]);
  }

  const leads = await tx.lead.findMany({
    where: openLeadsOf(ctx.tenantId, from.id),
    select: { id: true, teamId: true },
  });
  const reason = why === 'deactivated' ? 'OWNER_DEACTIVATED' : 'OWNER_REMOVED';
  const moved = await assignLeads(
    ctx,
    tx,
    leads.map((lead) => lead.id),
    queue ? null : to!.id,
    reason,
  );

  if (queue) {
    // ponytail: one episode per lead inside the 5 s interactive transaction; a
    // member holding thousands of open leads needs a set-based insert here.
    const rule = await activeRule(ctx.tenantId, tx);
    for (const lead of leads) {
      await openTriageEntry(tx, {
        tenantId: ctx.tenantId,
        leadId: lead.id,
        reason: 'OWNER_DEACTIVATED',
        detail: { formerOwnerName: from.fullName },
        rule,
        leadTeamId: lead.teamId,
      });
    }
  }
  if (to) {
    await tx.followUpTask.updateMany({ where: openObligationsOf(ctx.tenantId, from.id), data: { ownerId: to.id } });
    await tx.task.updateMany({
      where: openObligationsOf(ctx.tenantId, from.id),
      data: { ownerId: to.id, updatedById: ctx.actor.id },
    });
  }

  await audit(
    ctx,
    {
      event: 'OWNER_CHANGED',
      objectType: 'user',
      recordId: from.id,
      previousValue: { ownerId: from.id },
      newValue: { leadsTo: queue ? 'allocation-queue' : to!.id, followUpsAndTasksTo: to?.id ?? null },
      metadata: { action: `account.${why}.work_handed_over`, ...counts, leadIds: moved },
    },
    tx,
  );
  return work;
}

/**
 * A departing member stops being second owner of the open leads they worked
 * (M4-09). Their team rows stay, so left in place the leads would stay in their
 * former managers' scope however far from it the owner sits. Closed leads keep
 * naming them, as they keep naming an owner. One audit row, like the hand-over's.
 */
async function endSecondOwnership(ctx: Ctx, tx: TxClient, userId: string, why: 'deactivated' | 'removed') {
  const where = {
    tenantId: ctx.tenantId,
    secondaryOwnerId: userId,
    deletedAt: null,
    stage: { is: { category: 'OPEN' as const } },
    AND: [OPEN_LEADS_WHERE],
  };
  const leads = await tx.lead.findMany({ where, select: { id: true } });
  if (!leads.length) return;
  await tx.lead.updateMany({ where, data: { secondaryOwnerId: null, updatedById: ctx.actor.id } });
  await audit(
    ctx,
    {
      event: 'OWNER_CHANGED',
      objectType: 'user',
      recordId: userId,
      previousValue: { secondaryOwnerId: userId },
      newValue: { secondaryOwnerId: null },
      metadata: { action: `account.${why}.second_owner_ended`, leadIds: leads.map((lead) => lead.id) },
    },
    tx,
  );
}
