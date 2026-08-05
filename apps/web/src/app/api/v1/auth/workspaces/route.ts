import { NextResponse } from 'next/server';
import { ulid } from 'ulid';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { resolvePlatformCtx, switchActiveWorkspace } from '@/lib/auth/session';

const switchSchema = z.object({ workspaceId: z.string().min(1) });

export async function GET(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await resolvePlatformCtx(req, requestId);
    const memberships = await prisma.workspaceMembership.findMany({
      where: { platformUserId: ctx.platformUserId, status: 'ACTIVE', tenant: { deletedAt: null } },
      include: { tenant: true, salesUser: { include: { role: true } } },
      orderBy: { tenant: { displayName: 'asc' } },
    });
    return NextResponse.json({
      activeWorkspaceId: ctx.activeTenantId,
      workspaces: memberships.map((membership) => ({
        id: membership.tenant.id,
        slug: membership.tenant.slug,
        name: membership.tenant.displayName,
        status: membership.tenant.status,
        role: membership.salesUser?.role.key ?? membership.roleSnapshot,
      })),
    }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    return problem(error, requestId);
  }
}

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') ?? ulid();
  try {
    const ctx = await resolvePlatformCtx(req, requestId);
    const body = switchSchema.parse(await req.json());
    await switchActiveWorkspace(ctx, body.workspaceId);
    await prisma.platformAuditEvent.create({
      data: {
        tenantId: body.workspaceId,
        actorUserId: ctx.platformUserId,
        event: 'WORKSPACE_SWITCHED',
        objectType: 'workspace',
        objectId: body.workspaceId,
        requestId,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });
    return NextResponse.json({ ok: true }, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    return problem(error, requestId);
  }
}

function problem(error: unknown, requestId: string) {
  if (error instanceof AppError) {
    return NextResponse.json(error.toProblem(requestId), { status: error.status, headers: { 'x-request-id': requestId } });
  }
  return NextResponse.json({ status: 500, title: 'Internal error', requestId }, { status: 500 });
}
