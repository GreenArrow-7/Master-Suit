/**
 * "I have run out of leads."
 *
 * An agent asks, a leader decides. Approving allocates there and then and
 * records how many actually moved, because the interesting answer is usually
 * not the one that was asked for: the pool runs dry, or the asker is already at
 * their quota, and a request that reads APPROVED with nothing attached is
 * indistinguishable from one nobody has looked at.
 */
import { Prisma } from '@prisma/client';
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { prisma, withTx } from '@/lib/db';
import { audit } from '@/lib/security/audit';
import { can, type Ctx } from '@/lib/security/rbac';
import { allocate, headroom, type AllocateInput } from './allocation';

export const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface AskInput {
  ctx: Ctx;
  requested: number;
  reason?: string;
}

/** Asking. One open request at a time, which the partial unique index enforces. */
export async function askForLeads(input: AskInput) {
  const { ctx } = input;
  if (input.requested < 1 || input.requested > 5000) {
    throw Invalid([{ field: 'requested', code: 'range', message: 'Ask for between 1 and 5000.' }]);
  }

  return withTx(ctx.tenantId, async (tx) => {
    try {
      const request = await tx.allocationRequest.create({
        data: {
          tenantId: ctx.tenantId,
          requesterId: ctx.actor.id,
          requested: input.requested,
          reason: input.reason,
        },
      });

      await audit(
        ctx,
        {
          event: 'RECORD_CREATED',
          objectType: 'allocation',
          recordId: request.id,
          previousValue: {},
          newValue: { requested: input.requested, reason: input.reason },
        },
        tx,
      );

      return request;
    } catch (err) {
      // The index is the real guard; this turns it into a sentence.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Conflict('You already have a request waiting. Cancel it first if you want to change the number.');
      }
      throw err;
    }
  });
}

export interface CancelInput {
  ctx: Ctx;
  requestId: string;
}

/** Withdrawing your own ask. Only the person who made it. */
export async function cancelRequest(input: CancelInput) {
  const { ctx } = input;

  return withTx(ctx.tenantId, async (tx) => {
    const request = await tx.allocationRequest.findFirst({
      where: { id: input.requestId, tenantId: ctx.tenantId, deletedAt: null },
    });
    if (!request) throw NotFound('Allocation request');
    if (request.requesterId !== ctx.actor.id) throw Forbidden('Only the person who asked can withdraw it.');
    if (request.status !== 'PENDING') throw Conflict('That request has already been decided.');

    return tx.allocationRequest.update({
      where: { id: request.id, tenantId: ctx.tenantId },
      data: { status: 'CANCELLED', decidedById: ctx.actor.id, decidedAt: new Date() },
    });
  });
}

export interface DecideInput {
  ctx: Ctx;
  requestId: string;
  approve: boolean;
  note?: string;
  /** Cap what is handed over, when a leader wants to give less than asked. */
  grant?: number;
  filter?: AllocateInput['filter'];
}

/**
 * Deciding a request.
 *
 * The allocation happens *before* the status flips, and the status write is a
 * compare-and-swap on PENDING — so two leaders approving the same request at the
 * same moment cannot both hand leads over. The loser is told to reload rather
 * than silently double-allocating.
 *
 * Approving cannot run inside the allocation's transaction, because `allocate`
 * opens its own per-user transactions to take the SKIP LOCKED claim. Nesting
 * them would hold one connection while asking for another.
 */
export async function decideRequest(input: DecideInput) {
  const { ctx } = input;
  if (!can(ctx, 'allocation', 'APPROVE')) throw Forbidden('Deciding an allocation request is a leader’s call.');

  const request = await prisma.allocationRequest.findFirst({
    where: { id: input.requestId, tenantId: ctx.tenantId, deletedAt: null },
  });
  if (!request) throw NotFound('Allocation request');
  if (request.status !== 'PENDING') throw Conflict('That request has already been decided.');

  if (!input.approve) {
    if (!input.note?.trim()) {
      throw Invalid([{ field: 'note', code: 'required', message: 'Say why it was turned down.' }]);
    }
    // One shape either way: a caller that has to narrow a union before it can
    // read `status` will eventually forget to.
    return { request: await finish(ctx, request.id, 'REJECTED', input.note.trim(), null), result: null };
  }

  const count = Math.min(input.grant ?? request.requested, request.requested);
  const result = await allocate({
    ctx,
    userIds: [request.requesterId],
    count,
    filter: input.filter,
    reason: `ALLOCATION_REQUEST:${request.id}`,
  });

  return { request: await finish(ctx, request.id, 'APPROVED', input.note?.trim(), result.total), result };
}

async function finish(
  ctx: Ctx,
  requestId: string,
  status: RequestStatus,
  note: string | undefined,
  allocatedCount: number | null,
) {
  return withTx(ctx.tenantId, async (tx) => {
    const moved = await tx.allocationRequest.updateMany({
      where: { id: requestId, tenantId: ctx.tenantId, status: 'PENDING' },
      data: {
        status,
        decidedById: ctx.actor.id,
        decidedAt: new Date(),
        decisionNote: note,
        allocatedCount,
      },
    });
    if (moved.count === 0) {
      throw Conflict('Somebody else decided this request. Reload and try again.');
    }

    await audit(
      ctx,
      {
        event: 'STAGE_CHANGED',
        objectType: 'allocation',
        recordId: requestId,
        previousValue: { status: 'PENDING' },
        newValue: { status, allocatedCount, note },
      },
      tx,
    );

    return tx.allocationRequest.findFirstOrThrow({ where: { id: requestId, tenantId: ctx.tenantId } });
  });
}

/**
 * The queue a leader works through, with the headroom of each asker attached.
 *
 * Showing the request without the headroom means approving 200 for somebody who
 * can take 3, then wondering why the number came back different.
 */
export async function pendingRequests(tenantId: string, limit = 50) {
  const requests = await prisma.allocationRequest.findMany({
    where: { tenantId, status: 'PENDING', deletedAt: null },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  const room = await headroom(tenantId, [...new Set(requests.map((r) => r.requesterId))]);
  const roomBy = new Map(room.map((r) => [r.userId, r]));

  const names = await prisma.user.findMany({
    where: { tenantId, id: { in: requests.map((r) => r.requesterId) } },
    select: { id: true, fullName: true },
  });
  const nameBy = new Map(names.map((u) => [u.id, u.fullName]));

  return requests.map((r) => ({
    ...r,
    requesterName: nameBy.get(r.requesterId) ?? null,
    headroom: roomBy.get(r.requesterId) ?? null,
  }));
}
