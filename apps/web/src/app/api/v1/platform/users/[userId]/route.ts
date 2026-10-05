import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma, withPlatformTx } from '@/lib/db';
import { Conflict, NotFound } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { refuseOwnerLockout } from '@/services/platform/identity';
import { isPlatformStaff } from '@/lib/auth/credentials';
import { dropMonitoringCredential } from '@/services/identity/platformCredentials';
import { platformAudit } from '@/lib/security/audit';
import { bareRoute } from '@/lib/api/handler';

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

export const PATCH = bareRoute(
  '/api/v1/platform/users/[userId]',
  async (req, requestId, { params }: { params: Promise<{ userId: string }> }) => {
    const ctx = await requirePlatformOwner(req, requestId);
    const { userId } = await params;
    const body = updateSchema.parse(await req.json());
    if (body.platformRole || body.status) refuseSelfLockout(ctx.platformUserId, userId);

    const current = await prisma.platformUser.findFirst({ where: { id: userId, deletedAt: null } });
    if (!current) throw NotFound('User');
    // Same rule the recovery console enforces: the platform must never be left
    // without a usable owner. Applied here too, because two write paths for one
    // field with two different safety checks is one write path too many.
    if (body.platformRole || body.status) await refuseOwnerLockout(ctx, current);

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
      if (body.status && body.status !== 'ACTIVE') {
        await tx.platformMfaChallenge.deleteMany({ where: { platformUserId: current.id, consumedAt: null } });
      }
      await platformAudit(
        ctx,
        {
          event: 'PLATFORM_USER_UPDATED',
          objectType: 'platform_user',
          objectId: current.id,
          metadata: {
            before: { fullName: current.fullName, platformRole: current.platformRole, status: current.status },
            changes: body,
          },
        },
        tx,
      );
      return updated;
    });
    // Leaving platform staff ends the monitoring password. The session layer
    // already refuses a monitoring session for a non-staff identity; this removes
    // the credential itself so it cannot come back with a later promotion.
    if (body.platformRole && !isPlatformStaff(body.platformRole)) {
      await dropMonitoringCredential(current.id, 'ROLE_CHANGED');
    }

    return NextResponse.json({ user });
  },
);

/**
 * Soft delete: the row keeps existing so audit trails and record attributions
 * stay resolvable, but every session is revoked and every workspace membership
 * suspended, so the account cannot be used or invited back by accident.
 */
export const DELETE = bareRoute(
  '/api/v1/platform/users/[userId]',
  async (req, requestId, { params }: { params: Promise<{ userId: string }> }) => {
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
      await tx.platformMfaChallenge.deleteMany({ where: { platformUserId: current.id, consumedAt: null } });
      await tx.platformUser.update({
        where: { id: current.id },
        data: {
          monitoringPasswordHash: null,
          monitoringPasswordVersion: { increment: 1 },
          monitoringPasswordSetAt: null,
        },
      });
      await tx.workspaceMembership.updateMany({
        where: { platformUserId: current.id },
        data: { status: 'SUSPENDED' },
      });
      await platformAudit(
        ctx,
        {
          event: 'PLATFORM_USER_DELETED',
          objectType: 'platform_user',
          objectId: current.id,
          metadata: { email: current.email, fullName: current.fullName },
        },
        tx,
      );
    });

    return NextResponse.json({ deleted: true, id: current.id });
  },
);
