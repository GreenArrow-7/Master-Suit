import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { prisma, withPlatformTx } from '@/lib/db';
import { AppError, NotFound } from '@/lib/errors';
import { requirePlatformSupport } from '@/lib/auth/platform';
import { mayEnterWorkspace } from '@/lib/auth/platform-access';

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
    const ctx = await requirePlatformSupport(req, requestId);
    const { workspaceId } = await params;

    const workspace = await prisma.tenant.findFirst({
      where: { id: workspaceId, deletedAt: null },
      select: { id: true, slug: true, status: true, displayName: true },
    });
    if (!workspace) throw NotFound('Workspace');

    /**
     * The authorisation this route did not used to have.
     *
     * Being a platform OWNER was the whole of the check, so any workspace on the
     * platform could be opened by anyone holding the console — audited, which is
     * not the same as allowed. A READ grant names the person and the workspace;
     * coverage names the person and says "all of them", with a reason and an
     * expiry either way.
     *
     * 404, not 403. A workspace this person is not authorised for should not be
     * distinguishable from one that does not exist — otherwise the endpoint
     * enumerates the platform's customer list to any member of staff.
     */
    // Break-glass admits its holder only in an administration session. A
    // monitoring session needs a READ grant or coverage.
    const allowBreakGlass = ctx.credentialPurpose !== 'MONITORING';
    if (!(await mayEnterWorkspace(ctx.platformUserId, workspace.id, { allowBreakGlass }))) throw NotFound('Workspace');

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
          // Read-only is now the truth for every platform role, including
          // OWNER. It was not before: this same line recorded
          // `platform_support_readonly` for a session that could delete the
          // customer's payroll. Write access is a separate, audited act — see
          // the sibling `access` route.
          metadata: { slug: workspace.slug, mode: 'platform_readonly' },
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
    const ctx = await requirePlatformSupport(req, requestId);
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
