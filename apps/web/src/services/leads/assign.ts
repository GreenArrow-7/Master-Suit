import { prisma, type TxClient } from '@/lib/db';
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import { scopeFor, type Ctx } from '@/lib/security/rbac';
import { resolveOwnerIds, visibilityWhere } from '@/lib/security/visibility';
import { activeRule } from '@/services/distribution/assignLead';
import { openTriageEntry } from '@/services/distribution/triage';
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
 * The new owner must be an active member (`activeMemberWhere`). A suspended,
 * removed or invited account signs nobody in, so a lead handed to one sits where
 * no colleague at OWN scope sees it and the Allocation queue does not list it.
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
  if (ownerId) {
    const owner = await tx.user.findFirst({
      where: { ...activeMemberWhere(ctx.tenantId), id: ownerId },
      select: { id: true },
    });
    if (!owner) throw NotFound('User');
  }

  const scope = await visibilityWhere(ctx, 'leads', 'ASSIGN', { includeUnassigned: true, db: tx });
  const leads = await tx.lead.findMany({
    where: { ...scope, id: { in: leadIds }, deletedAt: null },
    select: { id: true, ownerId: true },
  });
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
  return ids;
}

/**
 * Who may be handed work: an ACTIVE, undeleted account whose workspace access
 * is active too. The platform console suspends a membership and leaves the
 * workspace User ACTIVE, and that person cannot sign in either. An account with
 * no membership row is not blocked, as in `assessEligibility`.
 */
export const activeMemberWhere = (tenantId: string) => ({
  tenantId,
  deletedAt: null,
  status: 'ACTIVE' as const,
  NOT: { workspaceMembership: { is: { status: { not: 'ACTIVE' as const } } } },
});

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
 * soft-deleted user.
 */
export async function handOverOpenWork(
  ctx: Ctx,
  tx: TxClient,
  from: { id: string; fullName: string },
  handOver: HandOver,
  why: 'deactivated' | 'removed',
): Promise<OpenWork> {
  const work = await countOpenWork(tx, ctx.tenantId, from.id);
  if (work.leads + work.followUps + work.tasks === 0) return work;

  const queue = handOver.leadsToQueue === true && work.leads > 0;
  const needsMember = (work.leads > 0 && !queue) || work.followUps + work.tasks > 0;
  if (needsMember && !handOver.toUserId) {
    throw Conflict(
      `${from.fullName} still owns ${describeOpenWork(work)}. Hand them to an active member` +
        `${work.leads ? ' (or send the leads to the allocation queue)' : ''} before this account is ${why}.`,
      { openWork: work },
    );
  }

  if (!(await mayHandOverWorkOf(ctx, from.id, tx))) {
    throw Forbidden(`${from.fullName}'s work is outside what you may assign. Ask someone who can assign it.`);
  }

  const to = handOver.toUserId
    ? await tx.user.findFirst({
        where: { ...activeMemberWhere(ctx.tenantId), id: handOver.toUserId },
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
      metadata: { action: `account.${why}.work_handed_over`, ...work, leadIds: moved },
    },
    tx,
  );
  return work;
}
