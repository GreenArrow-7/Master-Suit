import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ulid } from 'ulid';
import { prisma } from '@/lib/db';
import { resolveCtx } from '@/lib/auth/session';
import { requireWorkspace } from '@/lib/workspace';
import { can } from '@/lib/security/rbac';
import WorkspaceSidebar from '@/components/workspace/WorkspaceSidebar';
import WorkspaceTopBar from '@/components/workspace/WorkspaceTopBar';

export const dynamic = 'force-dynamic';

/** Every permission module the workspace navigation can gate an item on. */
const PERMISSION_KEYS = [
  'leads', 'opportunities', 'accounts', 'contacts', 'activities', 'tasks', 'documents',
  'tickets', 'products', 'fieldsales', 'campaigns', 'calls', 'events', 'forms',
  'landingpages', 'communications', 'automation', 'reports', 'dashboards', 'smartviews',
  'users', 'roles', 'settings', 'integrations', 'auditlogs',
];

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  try {
    const ctx = await resolveCtx(new Request(`http://internal/${workspaceSlug}`, { headers: await headers() }), ulid());
    const workspace = await requireWorkspace(ctx, workspaceSlug);
    const signedInAs = await prisma.user.findFirst({
      where: { tenantId: ctx.tenantId, id: ctx.actor.id },
      select: { fullName: true, email: true },
    });
    const modules = workspace.moduleEntitlements
      .filter((item) => ['TRIAL', 'ACTIVE', 'GRACE'].includes(item.state) && (!item.endsAt || item.endsAt > new Date()))
      .map((item) => item.module);
    const memberships = await prisma.workspaceMembership.findMany({
      where: { salesUserId: ctx.actor.id, status: 'ACTIVE', tenant: { deletedAt: null } },
      include: { tenant: true },
      orderBy: { tenant: { displayName: 'asc' } },
    });
    const availableWorkspaces = memberships.length > 0
      ? memberships.map((membership) => ({ slug: membership.tenant.slug, name: membership.tenant.displayName }))
      : [{ slug: workspace.slug, name: workspace.displayName }];
    // The sidebar is a client component and cannot evaluate permissions itself, so
    // resolve the VIEW grants here and hand it the list of navigable modules.
    const permitted = PERMISSION_KEYS.filter((key) => can(ctx, key, 'VIEW'));
    return <div className="lf-app-frame">
      <WorkspaceSidebar
        slug={workspace.slug}
        name={workspace.displayName}
        modules={modules}
        permitted={permitted}
        workspaces={availableWorkspaces}
        user={{ name: signedInAs?.fullName ?? signedInAs?.email ?? 'Signed in', role: ctx.actor.roleKey }}
      />
      <div className="lf-content-column">
        <WorkspaceTopBar slug={workspace.slug} workspaceName={workspace.displayName} plan={workspace.subscription?.plan.name ?? workspace.planCode} />
        <main className="lf-page-main">{children}</main>
      </div>
    </div>;
  } catch {
    redirect('/login');
  }
}
