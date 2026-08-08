import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import PermissionMatrix, { type MatrixRow } from '@/components/workspace/PermissionMatrix';
import { listRoles, permissionMatrix, roleAssignmentHistory } from '@/services/identity/roles';

export const metadata = { title: 'Roles and permissions' };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ roleId?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { roleId } = await searchParams;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { permission: ['roles', 'VIEW'] });
  const endpoint = `/api/v1/workspaces/${workspaceSlug}/roles`;
  const mayManage = can(ctx, 'roles', 'MANAGE_CONFIGURATION');

  const [roles, history, memberships] = await Promise.all([
    listRoles(ctx),
    roleAssignmentHistory(ctx, { limit: 100 }),
    prisma.workspaceMembership.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      include: { platformUser: { select: { fullName: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
  ]);

  const selected = roleId ? await permissionMatrix(ctx, roleId).catch(() => null) : null;

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
      <section>
        <div className="lf-eyebrow">Administration</div>
        <h1 style={{ margin: '8px 0 0' }}>Roles and permissions</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', maxWidth: '80ch' }}>
          A role is a set of permissions, each with a scope: how much of the workspace it reaches. You can only work on
          roles below your own level, and you can never grant more than you hold yourself — otherwise this screen would
          be a route to promoting yourself.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Roles</h2>
        <WorkspaceTable
          headers={['Role', 'Key', 'Rank', 'Default scope', 'Accounts', 'Permissions', '']}
          rows={roles.map((role) => [
            <span key="n">
              {role.name}
              {role.isSystem ? (
                <span className="lf-badge" style={{ marginLeft: 6 }}>
                  system
                </span>
              ) : null}
            </span>,
            <code key="k" style={{ fontSize: 'var(--lf-text-xs)' }}>
              {role.key}
            </code>,
            role.rank,
            role.defaultScope.toLowerCase(),
            role.users,
            role.permissions,
            <span key="a" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link className="lf-btn lf-btn--ghost" href={`?roleId=${role.id}`}>
                Permissions
              </Link>
              {mayManage && role.editable && !role.isSystem && role.users === 0 && (
                <WorkspaceActionButton
                  endpoint={`${endpoint}/delete`}
                  body={{ roleId: role.id }}
                  label="Delete"
                  variant="danger"
                  confirm={`Delete the role ${role.name}? This cannot be undone.`}
                />
              )}
            </span>,
          ])}
        />
      </section>

      {selected && (
        <section style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>{selected.role.name} permissions</h2>
              <p style={{ margin: '4px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
                {selected.editable
                  ? 'Scopes above your own level are shown but cannot be selected.'
                  : 'This role is at or above your own level, so it is read-only for you.'}
              </p>
            </div>
            <Link className="lf-btn lf-btn--ghost" href="?">
              Close
            </Link>
          </div>
          <PermissionMatrix
            endpoint={endpoint}
            roleId={selected.role.id}
            editable={mayManage && selected.editable}
            rows={selected.permissions as MatrixRow[]}
          />
        </section>
      )}

      {mayManage && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Create a role</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
            Rank orders seniority: lower is more senior. You cannot create a role at or above your own rank (
            {ctx.actor.roleRank}).
          </p>
          <WorkspaceRecordForm
            endpoint={`${endpoint}/create`}
            submitLabel="Create role"
            fields={[
              { name: 'name', label: 'Name', required: true },
              { name: 'key', label: 'Key (lowercase, no spaces)', required: true, placeholder: 'branch_supervisor' },
              {
                name: 'rank',
                label: 'Rank',
                type: 'number',
                required: true,
                placeholder: String(ctx.actor.roleRank + 10),
              },
              {
                name: 'defaultScope',
                label: 'Default scope',
                type: 'select',
                options: ['OWN', 'TEAM', 'BRANCH', 'REGION', 'ORGANIZATION'].map((value) => ({
                  value,
                  label: value.toLowerCase(),
                })),
              },
              { name: 'description', label: 'Description' },
            ]}
          />
        </section>
      )}

      {mayManage && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Assign a role for a period</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
            An additional, time-boxed grant alongside whatever the account already holds — how cover works while someone
            is on leave. Leave the dates blank for an open-ended grant; a grant with an end date lapses on its own
            rather than depending on anyone remembering.
          </p>
          <WorkspaceRecordForm
            endpoint={`${endpoint}/assign`}
            submitLabel="Assign role"
            fields={[
              {
                name: 'membershipId',
                label: 'Account',
                type: 'select',
                required: true,
                options: memberships.map((membership) => ({
                  value: membership.id,
                  label: `${membership.platformUser.fullName} · ${membership.platformUser.email}`,
                })),
              },
              {
                name: 'roleId',
                label: 'Role',
                type: 'select',
                required: true,
                options: roles
                  .filter((role) => role.editable)
                  .map((role) => ({ value: role.id, label: `${role.name} (rank ${role.rank})` })),
              },
              { name: 'effectiveFrom', label: 'From', type: 'date' },
              { name: 'effectiveTo', label: 'Until', type: 'date' },
            ]}
          />
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Assignment history</h2>
        <p style={{ margin: '0 0 10px', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
          Every grant and revocation is kept, including expired ones — who held what, and when, is the record that
          matters after the fact.
        </p>
        <WorkspaceTable
          headers={['Account', 'Role', 'Window', 'State', '']}
          empty="No additional role assignments."
          rows={history.map((assignment) => [
            <span key="h">
              {assignment.holder}
              <div style={{ color: 'var(--lf-ink-500)', fontSize: 'var(--lf-text-xs)' }}>{assignment.email}</div>
            </span>,
            assignment.role.name,
            `${assignment.effectiveFrom ? date(assignment.effectiveFrom) : 'always'} – ${assignment.effectiveTo ? date(assignment.effectiveTo) : 'open'}`,
            <span className="lf-badge" key="s">
              {assignment.inForce ? 'in force' : assignment.status.toLowerCase()}
            </span>,
            mayManage && assignment.status === 'ACTIVE' ? (
              <WorkspaceActionButton
                key="r"
                endpoint={`${endpoint}/revoke`}
                body={{ assignmentId: assignment.id }}
                label="Revoke"
                variant="ghost"
                promptFor={{ name: 'reason', label: 'Reason', required: false }}
              />
            ) : (
              (assignment.revocationReason ?? '—')
            ),
          ])}
        />
      </section>
    </div>
  );
}

const date = (value: Date) => value.toLocaleDateString('en-AE', { timeZone: 'UTC' });
