/**
 * Handing leads out.
 *
 * Three things the round-robin assigner does not do: allocate in bulk, honour
 * the quotas the schema has always advertised, and survive two leaders pressing
 * the button at the same moment.
 *
 * The last one is the reason the claim is raw SQL. `FOR UPDATE SKIP LOCKED` is
 * the same pattern the dialer uses to claim a contact: each transaction takes
 * rows nobody else holds and skips the rest rather than queueing behind them, so
 * two simultaneous allocations split the pool instead of one waiting for the
 * other and then handing out leads that are already gone.
 */
import { Prisma } from '@prisma/client';
import { Forbidden, Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { can, type Ctx } from '@/lib/security/rbac';

export interface Headroom {
  userId: string;
  /** How many more they may be given right now. Null means no limit is set. */
  available: number | null;
  reasons: string[];
}

const startOfToday = (now: Date) => {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const daysAgo = (now: Date, n: number) => new Date(now.getTime() - n * 86_400_000);

/**
 * How much more work somebody can be given.
 *
 * The four limits are different questions and the smallest one wins: three are
 * about how fast leads arrive, `activeLeadCapacity` is about how many they can
 * hold at once. A workspace that sets none gets no limit, which is what null
 * means — deliberately not zero, since defaulting an unset quota to zero would
 * stop every allocation in a workspace that never configured one.
 */
export async function headroom(tenantId: string, userIds: string[], now = new Date()): Promise<Headroom[]> {
  if (userIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { tenantId, id: { in: userIds }, deletedAt: null },
    select: {
      id: true,
      dailyLeadQuota: true,
      weeklyLeadQuota: true,
      monthlyLeadQuota: true,
      activeLeadCapacity: true,
      isAvailable: true,
      onLeaveUntil: true,
    },
  });

  const since = {
    day: startOfToday(now),
    week: daysAgo(now, 7),
    month: daysAgo(now, 30),
  };

  const [dayRows, weekRows, monthRows, heldRows] = await Promise.all([
    prisma.leadAssignmentHistory.groupBy({
      by: ['toOwnerId'],
      where: { tenantId, toOwnerId: { in: userIds }, createdAt: { gte: since.day } },
      _count: { _all: true },
    }),
    prisma.leadAssignmentHistory.groupBy({
      by: ['toOwnerId'],
      where: { tenantId, toOwnerId: { in: userIds }, createdAt: { gte: since.week } },
      _count: { _all: true },
    }),
    prisma.leadAssignmentHistory.groupBy({
      by: ['toOwnerId'],
      where: { tenantId, toOwnerId: { in: userIds }, createdAt: { gte: since.month } },
      _count: { _all: true },
    }),
    // Held right now, which is the capacity question rather than the rate one.
    prisma.lead.groupBy({
      by: ['ownerId'],
      where: {
        tenantId,
        ownerId: { in: userIds },
        deletedAt: null,
        stage: { is: { category: 'OPEN' } },
      },
      _count: { _all: true },
    }),
  ]);

  const count = (rows: { toOwnerId: string | null; _count: { _all: number } }[], id: string) =>
    rows.find((r) => r.toOwnerId === id)?._count._all ?? 0;

  return users.map((u) => {
    const reasons: string[] = [];
    const limits: number[] = [];

    const consider = (quota: number | null, used: number, label: string) => {
      if (quota === null) return;
      const left = Math.max(0, quota - used);
      limits.push(left);
      if (left === 0) reasons.push(`${label} quota reached (${used}/${quota})`);
    };

    consider(u.dailyLeadQuota, count(dayRows, u.id), 'daily');
    consider(u.weeklyLeadQuota, count(weekRows, u.id), 'weekly');
    consider(u.monthlyLeadQuota, count(monthRows, u.id), 'monthly');

    const held = heldRows.find((r) => r.ownerId === u.id)?._count._all ?? 0;
    consider(u.activeLeadCapacity, held, 'open-lead capacity');

    // Being away is not a quota, but handing somebody work while they are on
    // leave is the same mistake with a friendlier name.
    if (!u.isAvailable) reasons.push('marked unavailable');
    if (u.onLeaveUntil && u.onLeaveUntil > now) reasons.push('on leave');

    const blocked = !u.isAvailable || (u.onLeaveUntil !== null && u.onLeaveUntil > now);

    return {
      userId: u.id,
      available: blocked ? 0 : limits.length === 0 ? null : Math.min(...limits),
      reasons,
    };
  });
}

export interface AllocateInput {
  ctx: Ctx;
  /** Who to give leads to, in the order they should be filled. */
  userIds: string[];
  /** Total to hand out across everybody. Each person is still capped by quota. */
  count: number;
  /** Restrict the pool. All optional; unassigned and open is always implied. */
  filter?: { stageId?: string; source?: string; territoryId?: string; campaignId?: string };
  reason?: string;
}

export interface AllocationResult {
  allocated: { userId: string; leadIds: string[] }[];
  total: number;
  /** Named rather than swallowed: an allocation that quietly does less than
   *  asked looks like the pool was empty when it was really a quota. */
  skipped: { userId: string; reason: string }[];
  poolExhausted: boolean;
}

/**
 * Hand out a batch.
 *
 * Fills people in the order given, each up to their own headroom, until the
 * requested count or the pool runs out. Returns what actually happened rather
 * than a boolean, because "you asked for 200 and got 60" is the interesting
 * case and the caller has to be able to say why.
 */
export async function allocate(input: AllocateInput): Promise<AllocationResult> {
  const { ctx } = input;
  if (!can(ctx, 'allocation', 'APPROVE')) throw Forbidden('Handing leads out is a leader’s call.');
  if (input.userIds.length === 0) {
    throw Invalid([{ field: 'userIds', code: 'required', message: 'Say who is getting them.' }]);
  }
  if (input.count < 1) {
    throw Invalid([{ field: 'count', code: 'range', message: 'Allocate at least one.' }]);
  }

  const room = await headroom(ctx.tenantId, input.userIds);
  const roomBy = new Map(room.map((r) => [r.userId, r]));

  const allocated: { userId: string; leadIds: string[] }[] = [];
  const skipped: { userId: string; reason: string }[] = [];
  let remaining = input.count;
  let poolExhausted = false;

  for (const userId of input.userIds) {
    if (remaining <= 0) break;

    const r = roomBy.get(userId);
    if (!r) {
      skipped.push({ userId, reason: 'no such user in this workspace' });
      continue;
    }
    if (r.available === 0) {
      skipped.push({ userId, reason: r.reasons.join('; ') || 'no headroom' });
      continue;
    }

    const take = r.available === null ? remaining : Math.min(remaining, r.available);
    const leadIds = await claimForUser(ctx, userId, take, input.filter, input.reason);

    if (leadIds.length > 0) allocated.push({ userId, leadIds });
    remaining -= leadIds.length;

    if (leadIds.length < take) {
      poolExhausted = true;
      break;
    }
  }

  return { allocated, total: input.count - remaining, skipped, poolExhausted };
}

/**
 * Claim `take` unassigned leads for one person.
 *
 * The select and the update are one statement precisely so nothing can happen
 * between them. Without SKIP LOCKED two concurrent allocations would both read
 * the same ids, and the second would either block or overwrite the first's
 * assignment — which is how the same lead ends up promised to two agents.
 */
async function claimForUser(
  ctx: Ctx,
  userId: string,
  take: number,
  filter: AllocateInput['filter'],
  reason?: string,
): Promise<string[]> {
  if (take <= 0) return [];

  return withTx(ctx.tenantId, async (tx) => {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`l."tenantId" = ${ctx.tenantId}`,
      Prisma.sql`l."ownerId" IS NULL`,
      Prisma.sql`l."deletedAt" IS NULL`,
      Prisma.sql`s."category" = 'OPEN'`,
    ];
    if (filter?.stageId) conditions.push(Prisma.sql`l."stageId" = ${filter.stageId}`);
    if (filter?.source) conditions.push(Prisma.sql`l."source"::text = ${filter.source}`);
    if (filter?.territoryId) conditions.push(Prisma.sql`l."territoryId" = ${filter.territoryId}`);
    if (filter?.campaignId) conditions.push(Prisma.sql`l."campaignId" = ${filter.campaignId}`);

    const rows = await tx.$queryRaw<{ id: string }[]>`
      WITH picked AS (
        SELECT l."id"
        FROM "Lead" l
        JOIN "LeadStage" s ON s."id" = l."stageId"
        WHERE ${Prisma.join(conditions, ' AND ')}
        ORDER BY l."score" DESC, l."createdAt" ASC
        LIMIT ${take}
        FOR UPDATE OF l SKIP LOCKED
      )
      UPDATE "Lead"
         SET "ownerId" = ${userId},
             "assignedAt" = NOW(),
             "updatedById" = ${ctx.actor.id}
       WHERE "id" IN (SELECT "id" FROM picked)
      RETURNING "id"
    `;

    const leadIds = rows.map((r) => r.id);
    if (leadIds.length === 0) return [];

    await tx.leadAssignmentHistory.createMany({
      data: leadIds.map((leadId) => ({
        tenantId: ctx.tenantId,
        leadId,
        toOwnerId: userId,
        // A leader chose, rather than a rule firing.
        method: 'MANAGER_SELECTED' as const,
        reason: reason ?? 'BULK_ALLOCATION',
        assignedById: ctx.actor.id,
      })),
    });

    await audit(
      ctx,
      {
        event: 'RECORD_UPDATED',
        objectType: 'allocation',
        recordId: userId,
        previousValue: {},
        newValue: { allocated: leadIds.length, reason: reason ?? 'BULK_ALLOCATION' },
      },
      tx,
    );

    return leadIds;
  });
}

export interface RouteInput {
  ctx: Ctx;
  leadIds: string[];
  /** Where they are going. A person, or a team's pool. */
  toUserId?: string;
  toTeamId?: string;
  reason: string;
}

/**
 * Cross-segment routing.
 *
 * Moving a lead to another team is not the same as reassigning inside one: it
 * crosses a boundary somebody is accountable for, so it always carries a reason
 * and always leaves a history row naming who moved it.
 *
 * Routing to a team rather than a person clears the owner, putting the lead back
 * in that team's pool for the next allocation. That is deliberate — picking
 * somebody in the destination team would be guessing at their workload from
 * outside it.
 */
export async function routeLeads(input: RouteInput) {
  const { ctx } = input;
  if (!can(ctx, 'allocation', 'APPROVE')) throw Forbidden('Routing leads between teams is a leader’s call.');
  if (!input.toUserId && !input.toTeamId) {
    throw Invalid([{ field: 'toTeamId', code: 'required', message: 'Say where they are going.' }]);
  }
  if (input.toUserId && input.toTeamId) {
    throw Invalid([{ field: 'toUserId', code: 'ambiguous', message: 'Route to a person or to a team, not both.' }]);
  }
  if (!input.reason.trim()) {
    throw Invalid([{ field: 'reason', code: 'required', message: 'Say why they are moving.' }]);
  }
  if (input.leadIds.length === 0) {
    throw Invalid([{ field: 'leadIds', code: 'required', message: 'Nothing selected.' }]);
  }

  return withTx(ctx.tenantId, async (tx) => {
    if (input.toUserId) {
      const target = await tx.user.findFirst({
        where: { id: input.toUserId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!target) throw NotFound('User');
    }
    if (input.toTeamId) {
      const team = await tx.team.findFirst({
        where: { id: input.toTeamId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!team) throw NotFound('Team');
    }

    const leads = await tx.lead.findMany({
      where: { id: { in: input.leadIds }, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, ownerId: true, teamId: true },
    });
    if (leads.length === 0) throw NotFound('Leads');

    for (const lead of leads) {
      await tx.lead.update({
        where: { id: lead.id, tenantId: ctx.tenantId },
        data: {
          ownerId: input.toUserId ?? null,
          teamId: input.toTeamId ?? lead.teamId,
          assignedAt: input.toUserId ? new Date() : null,
          updatedById: ctx.actor.id,
        },
      });
      await tx.leadAssignmentHistory.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: lead.id,
          fromOwnerId: lead.ownerId,
          toOwnerId: input.toUserId ?? null,
          method: 'MANAGER_SELECTED',
          reason: input.reason.trim(),
          assignedById: ctx.actor.id,
        },
      });
    }

    await audit(
      ctx,
      {
        event: 'RECORD_UPDATED',
        objectType: 'allocation',
        recordId: input.toTeamId ?? input.toUserId!,
        previousValue: {},
        newValue: { routed: leads.length, reason: input.reason.trim() },
      },
      tx,
    );

    return { routed: leads.length };
  });
}

/** How much unassigned work is sitting there. */
export async function poolDepth(tenantId: string, filter?: AllocateInput['filter']) {
  return prisma.lead.count({
    where: {
      tenantId,
      ownerId: null,
      deletedAt: null,
      stage: { is: { category: 'OPEN' } },
      ...(filter?.stageId ? { stageId: filter.stageId } : {}),
      ...(filter?.territoryId ? { territoryId: filter.territoryId } : {}),
      ...(filter?.campaignId ? { campaignId: filter.campaignId } : {}),
    },
  });
}
