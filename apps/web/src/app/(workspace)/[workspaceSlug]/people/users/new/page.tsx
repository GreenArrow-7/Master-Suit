import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import { Forbidden } from '@/lib/errors';
import NewUserForm from './NewUserForm';

export const metadata = { title: 'Add user' };

/**
 * Add user — creates the employee record and the login together.
 *
 * The role list is cut to what this administrator may actually grant. Offering
 * a role the server will refuse teaches people that the form lies; the same
 * rank rule is enforced again in `createStaffAccount`, because a filtered
 * dropdown is a courtesy and not a control.
 */
export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { permission: ['users', 'MANAGE_USERS'] });
  if (!can(ctx, 'users', 'MANAGE_USERS')) throw Forbidden('You cannot add users to this workspace.');

  const [roles, departments, designations, branches, locations, managers] = await Promise.all([
    prisma.role.findMany({
      where: { tenantId: ctx.tenantId, rank: { gt: ctx.actor.roleRank } },
      orderBy: { rank: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.department.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.designation.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.branch.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.hrWorkLocation.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true },
    }),
    prisma.employeeProfile.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
      orderBy: { employeeNumber: 'asc' },
      select: {
        id: true,
        employeeNumber: true,
        membership: { select: { platformUser: { select: { fullName: true } } } },
      },
    }),
  ]);

  return (
    <div className="lf-page-stack">
      <section>
        <div className="lf-eyebrow">Administration</div>
        <h1 style={{ margin: '8px 0 0' }}>Add user</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)', maxWidth: '92ch' }}>
          Creates the employee record and the login together, and issues a temporary password shown once. If the person
          can be emailed, send them an invitation instead — that way nobody but its owner ever knows their password.
        </p>
      </section>

      <NewUserForm
        endpoint={`/api/v1/workspaces/${workspaceSlug}/identity`}
        usersHref={`/${workspaceSlug}/people/users`}
        workspaceSlug={workspaceSlug}
        roles={roles}
        departments={departments}
        designations={designations}
        branches={branches}
        locations={locations.map((location) => ({
          id: location.id,
          name: location.code ? `${location.name} · ${location.code}` : location.name,
        }))}
        managers={managers.map((manager) => ({
          id: manager.id,
          name: `${manager.membership.platformUser.fullName} · ${manager.employeeNumber}`,
        }))}
      />
    </div>
  );
}
