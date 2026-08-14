import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma, withPlatformTx } from '@/lib/db';
import { AppError, Conflict, NotFound } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';

const updateSchema = z
  .object({
    fullName: z.string().min(2).max(120).optional(),
    platformRole: z.enum(['USER', 'OWNER', 'SUPPORT', 'SECURITY_AUDITOR']).optional(),
    status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one change is required.');

/**
 * The one rule both handlers share: the owner cannot edit themselves out of the
 * platform. Demoting or deleting your own account leaves nobody able to undo
 * it — the classic locked-out-admin incident — so self-changes to role, status
 * and existence are refused, not confirmed.
 */
function refuseSelfLockout(actorId: string, targetId: string) {
  if (actorId === targetId) {
    throw Conflict('You cannot change or remove your own platform account. Ask another platform owner.');
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const { userId } = await params;
    const body = updateSchema.parse(await req.json());
    if (body.platformRole || body.status) refuseSelfLockout(ctx.platformUserId, userId);

    const current = await prisma.platformUser.findFirst({ where: { id: userId, deletedAt: null } });
    if (!current) throw NotFound('User');

    const user = await withPlatformTx(async (tx) => {
      const updated = await tx.platformUser.update({
        where: { id: current.id },
        data: {
          fullName: body.fullName,
          platformRole: body.platformRole,
          status: body.status,
        },
        select: { id: true, email: true, fullName: true, platformRole: true, status: true },
      });
      // A suspended or deactivated account must stop working now, not at TTL.
      if (body.status && body.status !== 'ACTIVE') {
        await tx.platformSession.updateMany({
          where: { platformUserId: current.id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'ACCOUNT_STATUS_CHANGE' },
        });
      }
      await tx.platformAuditEvent.create({
        data: {
          actorUserId: ctx.platformUserId,
          event: 'PLATFORM_USER_UPDATED',
          objectType: 'platform_user',
          objectId: current.id,
          requestId,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: {
            before: { fullName: current.fullName, platformRole: current.platformRole, status: current.status },
            changes: body,
          },
        },
      });
      return updated;
    });

    return NextResponse.json({ user }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toProblem(requestId), {
        status: error.status,
        headers: { 'x-request-id': requestId },
      });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { status: 422, title: 'Validation failed', requestId, errors: error.flatten() },
        { status: 422 },
      );
    }
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}

/**
 * Soft delete: the row keeps existing so audit trails and record attributions
 * stay resolvable, but every session is revoked and every workspace membership
 * suspended, so the account cannot be used or invited back by accident.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const { userId } = await params;
    refuseSelfLockout(ctx.platformUserId, userId);

    const current = await prisma.platformUser.findFirst({ where: { id: userId, deletedAt: null } });
    if (!current) throw NotFound('User');

    const now = new Date();
    await withPlatformTx(async (tx) => {
      await tx.platformUser.update({
        where: { id: current.id },
        data: { deletedAt: now, status: 'DEACTIVATED' },
      });
      await tx.platformSession.updateMany({
        where: { platformUserId: current.id, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'ACCOUNT_DELETED' },
      });
      await tx.workspaceMembership.updateMany({
        where: { platformUserId: current.id },
        data: { status: 'SUSPENDED' },
      });
      await tx.platformAuditEvent.create({
        data: {
          actorUserId: ctx.platformUserId,
          event: 'PLATFORM_USER_DELETED',
          objectType: 'platform_user',
          objectId: current.id,
          requestId,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { email: current.email, fullName: current.fullName },
        },
      });
    });

    return NextResponse.json({ deleted: true, id: current.id }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(error.toProblem(requestId), {
        status: error.status,
        headers: { 'x-request-id': requestId },
      });
    }
    return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
  }
}
