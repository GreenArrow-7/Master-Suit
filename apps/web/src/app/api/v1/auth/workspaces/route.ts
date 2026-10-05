import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { Forbidden } from '@/lib/errors';
import { resolvePlatformCtx, switchActiveWorkspace } from '@/lib/auth/session';
import { platformAudit } from '@/lib/security/audit';
import { bareRoute } from '@/lib/api/handler';

const switchSchema = z.object({ workspaceId: z.string().min(1) });

export const GET = bareRoute('/api/v1/auth/workspaces', async (req, requestId) => {
  const ctx = await resolvePlatformCtx(req, requestId);
  // A monitoring session uses no membership, so it has none to list.
  if (ctx.credentialPurpose === 'MONITORING') {
    return NextResponse.json({ activeWorkspaceId: ctx.activeTenantId, workspaces: [] });
  }
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
  });
});

export const POST = bareRoute('/api/v1/auth/workspaces', async (req, requestId) => {
  const ctx = await resolvePlatformCtx(req, requestId);
  // Switching by membership would hand a monitoring session the member's own
  // workspace role. It enters workspaces through its grants instead.
  if (ctx.credentialPurpose === 'MONITORING') {
    throw Forbidden('A monitoring session enters workspaces from the monitoring console.');
  }
  const body = switchSchema.parse(await req.json());
  await switchActiveWorkspace(ctx, body.workspaceId);
  await platformAudit(ctx, {
    tenantId: body.workspaceId,
    event: 'WORKSPACE_SWITCHED',
    objectType: 'workspace',
    objectId: body.workspaceId,
  });
  return NextResponse.json({ ok: true });
});
