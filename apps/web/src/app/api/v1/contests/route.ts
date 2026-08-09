import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import {
  createContest,
  decideContest,
  leaderboard,
  CONTEST_METRICS,
  CONTEST_STATUSES,
} from '@/services/engagement/contests';
import { closeCategory, nominate, results, vote } from '@/services/engagement/nominations';

const listQuery = z
  .object({
    contestId: z.string().cuid().optional(),
    eventId: z.string().cuid().optional(),
    status: z.enum(CONTEST_STATUSES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

/** Contests, one contest's board, or an event's nomination results. */
export const GET = route(
  { module: 'contests', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    if (query.eventId) return { data: await results(ctx, query.eventId) };
    if (query.contestId) return leaderboard(ctx.tenantId, query.contestId);

    const data = await prisma.contest.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, ...(query.status ? { status: query.status } : {}) },
      orderBy: [{ status: 'asc' }, { endAt: 'desc' }],
      take: query.limit,
    });
    return { data };
  },
);

const contestBody = z
  .object({
    action: z.literal('CONTEST'),
    name: z.string().min(2).max(160),
    description: z.string().max(2000).optional(),
    metric: z.enum(CONTEST_METRICS),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    teamId: z.string().cuid().optional(),
    prize: z.string().max(500).optional(),
  })
  .strict();

const nominateBody = z
  .object({
    action: z.literal('NOMINATE'),
    eventId: z.string().cuid(),
    category: z.string().min(2).max(120),
    nomineeId: z.string().cuid(),
    reason: z.string().max(2000).optional(),
  })
  .strict();

const voteBody = z.object({ action: z.literal('VOTE'), nominationId: z.string().cuid() }).strict();

/**
 * Starting a contest, putting somebody forward, or voting.
 *
 * All three are creates. Voting lives here rather than under its own route
 * because the one-vote-per-category rule belongs with the nomination it moves
 * between.
 */
export const POST = route(
  {
    module: 'contests',
    productModule: 'SALES',
    action: 'VIEW',
    body: z.discriminatedUnion('action', [contestBody, nominateBody, voteBody]),
    auditEvent: 'RECORD_CREATED',
  },
  async ({ ctx, body }) => {
    if (body.action === 'CONTEST') {
      // createContest checks contests:CREATE itself — running a contest is a
      // leader's call, while nominating and voting are everybody's.
      const { action: _action, ...rest } = body;
      return createContest({ ctx, ...rest });
    }
    if (body.action === 'NOMINATE') {
      return nominate({
        ctx,
        eventId: body.eventId,
        category: body.category,
        nomineeId: body.nomineeId,
        reason: body.reason,
      });
    }
    return vote({ ctx, nominationId: body.nominationId });
  },
);

const decideBody = z
  .object({ action: z.literal('DECIDE'), contestId: z.string().cuid(), to: z.enum(CONTEST_STATUSES) })
  .strict();

const closeBody = z
  .object({ action: z.literal('CLOSE_CATEGORY'), eventId: z.string().cuid(), category: z.string().min(2).max(120) })
  .strict();

export const PATCH = route(
  {
    module: 'contests',
    productModule: 'SALES',
    action: 'EDIT',
    body: z.discriminatedUnion('action', [decideBody, closeBody]),
    auditEvent: 'STAGE_CHANGED',
  },
  async ({ ctx, body }) => {
    if (body.action === 'DECIDE') return decideContest({ ctx, contestId: body.contestId, to: body.to });
    return closeCategory({ ctx, eventId: body.eventId, category: body.category });
  },
);
