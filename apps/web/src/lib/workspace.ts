import { prisma } from '@/lib/db';
import { NotFound, Forbidden } from '@/lib/errors';
import { assertModuleEntitlement, type ProductModule } from '@/lib/security/entitlements';
import type { Ctx } from '@/lib/security/rbac';

export async function requireWorkspace(ctx: Ctx, workspaceSlug: string, module?: ProductModule) {
  const workspace = await prisma.tenant.findFirst({
    where: { id: ctx.tenantId, slug: workspaceSlug, deletedAt: null },
    include: {
      subscription: { include: { plan: true } },
      moduleEntitlements: true,
      _count: { select: { memberships: true, employeeProfiles: true, users: true } },
    },
  });
  if (!workspace) throw NotFound('Workspace');
  if (workspace.status !== 'ACTIVE') throw Forbidden('This workspace is suspended.');
  if (module) await assertModuleEntitlement(workspace.id, module);
  return workspace;
}

export function workspacePath(slug: string, path = '') {
  return `/${slug}${path.startsWith('/') ? path : `/${path}`}`;
}
