/**
 * Contests and their leaderboards.
 *
 * A contest does not compute anything of its own. It names a window, a metric
 * and who is in it, then asks the same ranking the leader dashboard uses — two
 * answers to "who sold the most" would eventually disagree, and the one on the
 * wall would be the one nobody could reproduce.
 *
 * Standings are live while it runs and **frozen** when it closes. A booking
 * cancelled in March must not quietly change who won February.
 */
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { can, type Ctx } from '@/lib/security/rbac';
import { rank, type BoardMetric } from '@/services/leadership/rollups';

export const CONTEST_METRICS = ['bookings', 'revenue', 'leads', 'activities'] as const;
export const CONTEST_STATUSES = ['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED'] as const;
export type ContestStatus = (typeof CONTEST_STATUSES)[number];

const ALLOWED: Record<ContestStatus, readonly ContestStatus[]> = {
  DRAFT: ['OPEN', 'CANCELLED'],
  OPEN: ['CLOSED', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: [],
};

export const canTransition = (from: ContestStatus, to: ContestStatus) => ALLOWED[from].includes(to);

export interface CreateContestInput {
  ctx: Ctx;
  name: string;
  description?: string;
  metric: BoardMetric;
  startAt: Date;
  endAt: Date;
  teamId?: string;
  prize?: string;
}

export async function createContest(input: CreateContestInput) {
  const { ctx } = input;
  if (!can(ctx, 'contests', 'CREATE')) throw Forbidden('Running a contest is a leader’s call.');
  if (input.endAt <= input.startAt) {
    throw Invalid([{ field: 'endAt', code: 'range', message: 'A contest cannot end before it starts.' }]);
  }

  return withTx(ctx.tenantId, async (tx) => {
    const contest = await tx.contest.create({
      data: {
        tenantId: ctx.tenantId,
        name: input.name,
        description: input.description,
        metric: input.metric,
        startAt: input.startAt,
        endAt: input.endAt,
        teamId: input.teamId,
        prize: input.prize,
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
      },
    });

    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'contests',
        recordId: contest.id,
        previousValue: {},
        newValue: { name: contest.name, metric: contest.metric },
      },
      tx,
    );

    return contest;
  });
}

/** Everybody eligible to appear on this contest's board. */
async function entrants(tenantId: string, teamId: string | null): Promise<string[]> {
  // Empty means the whole workspace, matching the rollups module's convention.
  if (!teamId) return [];
  const rows = await prisma.userTeam.findMany({ where: { tenantId, teamId }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

export interface Standing {
  rank: number;
  userId: string;
  name: string | null;
  value: string;
}

/**
 * The board.
 *
 * Live for a running contest, read back from the frozen rows for a closed one.
 * The caller cannot tell the difference, which is the point: a closed contest's
 * page must keep showing what it showed the day it closed.
 */
export async function leaderboard(
  tenantId: string,
  contestId: string,
): Promise<{ frozen: boolean; standings: Standing[] }> {
  const contest = await prisma.contest.findFirst({
    where: { id: contestId, tenantId, deletedAt: null },
  });
  if (!contest) throw NotFound('Contest');

  if (contest.status === 'CLOSED') {
    const rows = await prisma.contestStanding.findMany({
      where: { tenantId, contestId },
      // Narrowed to the same shape the live board returns. Handing back the
      // whole row would put tenantId in the response and make one endpoint
      // answer in two different shapes depending on status.
      select: { rank: true, userId: true, value: true },
      orderBy: { rank: 'asc' },
    });
    return { frozen: true, standings: await withNames(tenantId, rows) };
  }

  const rows = await rank(
    tenantId,
    await entrants(tenantId, contest.teamId),
    { from: contest.startAt, to: contest.endAt },
    contest.metric as BoardMetric,
  );

  return {
    frozen: false,
    standings: await withNames(
      tenantId,
      rows.map((r, i) => ({ rank: i + 1, userId: r.userId, value: String(r.value) })),
    ),
  };
}

async function withNames(tenantId: string, rows: { rank: number; userId: string; value: string }[]) {
  const users = await prisma.user.findMany({
    where: { tenantId, id: { in: rows.map((r) => r.userId) } },
    select: { id: true, fullName: true },
  });
  const nameBy = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => ({ ...r, name: nameBy.get(r.userId) ?? null }));
}

export interface DecideContestInput {
  ctx: Ctx;
  contestId: string;
  to: ContestStatus;
}

/**
 * Opening, closing or abandoning a contest.
 *
 * Closing is the only one that writes anything beyond a status: it computes the
 * standings once and stores them, after which nothing recomputes them.
 */
export async function decideContest(input: DecideContestInput) {
  const { ctx } = input;
  if (!can(ctx, 'contests', 'EDIT')) throw Forbidden('Closing a contest is a leader’s call.');

  const contest = await prisma.contest.findFirst({
    where: { id: input.contestId, tenantId: ctx.tenantId, deletedAt: null },
  });
  if (!contest) throw NotFound('Contest');

  const from = contest.status as ContestStatus;
  if (!canTransition(from, input.to)) {
    throw Invalid([
      {
        field: 'status',
        code: 'illegal_transition',
        message: `A ${from.toLowerCase()} contest cannot become ${input.to.toLowerCase()}.`,
      },
    ]);
  }

  /**
   * Ranked *before* the transaction opens, not inside it.
   *
   * `rank` and `entrants` read through the global client, and inside `withTx`
   * that client skips setting `app.tenant_id` — it assumes the surrounding
   * transaction already did, on a connection these queries do not share. Row
   * level security then matches nothing and the contest closes with an empty
   * result, silently. The standings are a snapshot by definition, so taking it
   * a moment before the status flips costs nothing.
   */
  const standings =
    input.to === 'CLOSED'
      ? await rank(
          ctx.tenantId,
          await entrants(ctx.tenantId, contest.teamId),
          { from: contest.startAt, to: contest.endAt },
          contest.metric as BoardMetric,
        )
      : [];

  return withTx(ctx.tenantId, async (tx) => {
    // Compare-and-swap: somebody else may have closed it while we were ranking.
    const moved = await tx.contest.updateMany({
      where: { id: contest.id, tenantId: ctx.tenantId, status: from },
      data: {
        status: input.to,
        closedAt: input.to === 'CLOSED' ? new Date() : undefined,
        closedById: input.to === 'CLOSED' ? ctx.actor.id : undefined,
        updatedById: ctx.actor.id,
      },
    });
    if (moved.count === 0) throw Conflict('Somebody else changed this contest. Reload and try again.');

    if (standings.length > 0) {
      await tx.contestStanding.createMany({
        data: standings.map((s, i) => ({
          tenantId: ctx.tenantId,
          contestId: contest.id,
          userId: s.userId,
          rank: i + 1,
          value: String(s.value),
        })),
        skipDuplicates: true,
      });
    }

    await audit(
      ctx,
      {
        event: 'STAGE_CHANGED',
        objectType: 'contests',
        recordId: contest.id,
        previousValue: { status: from },
        newValue: { status: input.to, standings: standings.length },
      },
      tx,
    );

    return tx.contest.findFirstOrThrow({ where: { id: contest.id, tenantId: ctx.tenantId } });
  });
}
