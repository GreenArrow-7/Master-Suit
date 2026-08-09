/**
 * Nominations and team voting.
 *
 * Hangs off an Event because that is where the award is given and where the
 * RSVP already lives — an offsite does not need a second kind of record to
 * describe it.
 *
 * The rule that matters is one vote per person per category. It is a unique
 * index rather than a check in this file, because two taps racing each other is
 * exactly when a read-then-write loses.
 */
import { Prisma } from '@prisma/client';
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { can, type Ctx } from '@/lib/security/rbac';

export const NOMINATION_STATUSES = ['OPEN', 'WITHDRAWN', 'WON'] as const;
export type NominationStatus = (typeof NOMINATION_STATUSES)[number];

export interface NominateInput {
  ctx: Ctx;
  eventId: string;
  category: string;
  nomineeId: string;
  reason?: string;
}

export async function nominate(input: NominateInput) {
  const { ctx } = input;
  const category = input.category.trim();
  if (category.length === 0) {
    throw Invalid([{ field: 'category', code: 'required', message: 'Say what they are being nominated for.' }]);
  }
  if (input.nomineeId === ctx.actor.id) {
    throw Invalid([{ field: 'nomineeId', code: 'self', message: 'Somebody else has to put you forward.' }]);
  }

  return withTx(ctx.tenantId, async (tx) => {
    const event = await tx.event.findFirst({
      where: { id: input.eventId, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!event) throw NotFound('Event');
    if (event.status === 'CANCELLED' || event.status === 'COMPLETED') {
      throw Conflict('Nominations for this event are closed.');
    }

    const nominee = await tx.user.findFirst({
      where: { id: input.nomineeId, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!nominee) throw NotFound('Nominee');

    try {
      const nomination = await tx.nomination.create({
        data: {
          tenantId: ctx.tenantId,
          eventId: event.id,
          category,
          nomineeId: input.nomineeId,
          nominatedById: ctx.actor.id,
          reason: input.reason,
        },
      });

      await audit(
        ctx,
        {
          event: 'RECORD_CREATED',
          objectType: 'contests',
          recordId: nomination.id,
          previousValue: {},
          newValue: { eventId: event.id, category, nomineeId: input.nomineeId },
        },
        tx,
      );

      return nomination;
    } catch (err) {
      // The unique index is the real guard; this turns it into a sentence.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Conflict('They have already been nominated in that category.');
      }
      throw err;
    }
  });
}

export interface VoteInput {
  ctx: Ctx;
  nominationId: string;
}

/**
 * One vote, per person, per category.
 *
 * Changing your mind moves the vote rather than adding a second — otherwise the
 * only way to switch is to vote twice, which the index refuses and which would
 * leave somebody unable to correct a misclick.
 */
export async function vote(input: VoteInput) {
  const { ctx } = input;

  return withTx(ctx.tenantId, async (tx) => {
    const nomination = await tx.nomination.findFirst({
      where: { id: input.nominationId, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, eventId: true, category: true, nomineeId: true, status: true },
    });
    if (!nomination) throw NotFound('Nomination');
    if (nomination.status !== 'OPEN') throw Conflict('That nomination is no longer open for votes.');
    if (nomination.nomineeId === ctx.actor.id) {
      throw Invalid([{ field: 'nominationId', code: 'self', message: 'You cannot vote for yourself.' }]);
    }

    const event = await tx.event.findFirst({
      where: { id: nomination.eventId, tenantId: ctx.tenantId },
      select: { status: true },
    });
    if (event?.status === 'CANCELLED' || event?.status === 'COMPLETED') {
      throw Conflict('Voting for this event has closed.');
    }

    const existing = await tx.nominationVote.findFirst({
      where: {
        tenantId: ctx.tenantId,
        eventId: nomination.eventId,
        category: nomination.category,
        voterId: ctx.actor.id,
      },
      select: { id: true, nominationId: true },
    });

    if (existing?.nominationId === nomination.id) {
      throw Conflict('You have already voted for them.');
    }

    if (existing) {
      await tx.nominationVote.update({
        where: { id: existing.id, tenantId: ctx.tenantId },
        data: { nominationId: nomination.id },
      });
      return { moved: true };
    }

    await tx.nominationVote.create({
      data: {
        tenantId: ctx.tenantId,
        nominationId: nomination.id,
        eventId: nomination.eventId,
        category: nomination.category,
        voterId: ctx.actor.id,
      },
    });
    return { moved: false };
  });
}

export interface CategoryResult {
  category: string;
  nominations: {
    nominationId: string;
    nomineeId: string;
    name: string | null;
    reason: string | null;
    status: NominationStatus;
    votes: number;
    /** Whether the person asking voted for this one. */
    mine: boolean;
  }[];
  /** Null while it is a genuine tie, so nobody is declared winner by sort order. */
  leaderId: string | null;
  tied: boolean;
}

/** Every category at an event, with its standings. */
export async function results(ctx: Ctx, eventId: string): Promise<CategoryResult[]> {
  const nominations = await prisma.nomination.findMany({
    where: { tenantId: ctx.tenantId, eventId, deletedAt: null },
    select: {
      id: true,
      category: true,
      nomineeId: true,
      reason: true,
      status: true,
      votes: { select: { voterId: true } },
    },
    orderBy: { category: 'asc' },
  });

  const users = await prisma.user.findMany({
    where: { tenantId: ctx.tenantId, id: { in: [...new Set(nominations.map((n) => n.nomineeId))] } },
    select: { id: true, fullName: true },
  });
  const nameBy = new Map(users.map((u) => [u.id, u.fullName]));

  const byCategory = new Map<string, CategoryResult>();
  for (const n of nominations) {
    let group = byCategory.get(n.category);
    if (!group) {
      group = { category: n.category, nominations: [], leaderId: null, tied: false };
      byCategory.set(n.category, group);
    }
    group.nominations.push({
      nominationId: n.id,
      nomineeId: n.nomineeId,
      name: nameBy.get(n.nomineeId) ?? null,
      reason: n.reason,
      status: n.status as NominationStatus,
      votes: n.votes.length,
      mine: n.votes.some((v) => v.voterId === ctx.actor.id),
    });
  }

  for (const group of byCategory.values()) {
    group.nominations.sort((a, b) => b.votes - a.votes);
    const [first, second] = group.nominations;
    if (!first || first.votes === 0) continue;
    // A tie is a tie. Declaring one of them the winner because they happened to
    // sort first is how an award goes to the wrong person.
    group.tied = second?.votes === first.votes;
    group.leaderId = group.tied ? null : first.nomineeId;
  }

  return [...byCategory.values()];
}

export interface CloseCategoryInput {
  ctx: Ctx;
  eventId: string;
  category: string;
}

/** Marking the winner of one category. Refuses a tie rather than picking. */
export async function closeCategory(input: CloseCategoryInput) {
  const { ctx } = input;
  if (!can(ctx, 'contests', 'EDIT')) throw Forbidden('Declaring a winner is a leader’s call.');

  const all = await results(ctx, input.eventId);
  const group = all.find((g) => g.category === input.category.trim());
  if (!group) throw NotFound('Category');
  if (group.tied) {
    throw Conflict('That category is tied. Break the tie before declaring a winner.');
  }
  if (!group.leaderId) throw Conflict('Nobody has been voted for in that category.');

  const winner = group.nominations.find((n) => n.nomineeId === group.leaderId)!;

  return withTx(ctx.tenantId, async (tx) => {
    await tx.nomination.update({
      where: { id: winner.nominationId, tenantId: ctx.tenantId },
      data: { status: 'WON', updatedById: ctx.actor.id },
    });

    await audit(
      ctx,
      {
        event: 'STAGE_CHANGED',
        objectType: 'contests',
        recordId: winner.nominationId,
        previousValue: { status: 'OPEN' },
        newValue: { status: 'WON', category: group.category, votes: winner.votes },
      },
      tx,
    );

    return { category: group.category, winnerId: winner.nomineeId, votes: winner.votes };
  });
}
