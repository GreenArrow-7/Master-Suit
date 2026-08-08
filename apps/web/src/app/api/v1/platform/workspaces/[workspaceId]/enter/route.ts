import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { prisma, withPlatformTx } from '@/lib/db';
import { AppError, NotFound } from '@/lib/errors';
import { requirePlatformOwner } from '@/lib/auth/platform';

/**
 * Opens a customer workspace for platform staff.
 *
 * Points the caller's platform session at this tenant, which is what resolveCtx
 * reads to build the read-only support actor. Without this there is no route from
 * the platform console into a workspace at all: platform staff hold no
 * membership, so every /{slug}/... URL bounced to /login and the People and Sales
 * modules were unreachable for the owner.
 *
 * Entry is always audited — looking at a customer's data is an event worth having
 * a record of, even when it is the platform owner doing it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const requestId = ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    const { workspaceId } = await params;

    const workspace = await prisma.tenant.findFirst({
      where: { id: workspaceId, deletedAt: null },
      select: { id: true, slug: true, status: true, displayName: true },
    });
    if (!workspace) throw NotFound('Workspace');

    await withPlatformTx(async (tx) => {
      await tx.platformSession.update({
        where: { id: ctx.sessionId },
        data: { activeTenantId: workspace.id, lastSeenAt: new Date() },
      });
      await tx.platformAuditEvent.create({
        data: {
          tenantId: workspace.id,
          actorUserId: ctx.platformUserId,
          event: 'WORKSPACE_OPENED',
          objectType: 'workspace',
          objectId: workspace.id,
          requestId,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { slug: workspace.slug, mode: 'platform_support_readonly' },
        },
      });
    });

    return NextResponse.json(
      { destination: `/${workspace.slug}/dashboard`, workspace },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(err.toProblem(requestId), { status: err.status });
    }
    throw err;
  }
}

/** Leaves the workspace and returns platform staff to the control plane. */
export async function DELETE(req: Request) {
  const requestId = ulid();
  try {
    const ctx = await requirePlatformOwner(req, requestId);
    await prisma.platformSession.update({
      where: { id: ctx.sessionId },
      data: { activeTenantId: null, lastSeenAt: new Date() },
    });
    return NextResponse.json({ destination: '/platform' }, { headers: { 'x-request-id': requestId } });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(err.toProblem(requestId), { status: err.status });
    }
    throw err;
  }
}
