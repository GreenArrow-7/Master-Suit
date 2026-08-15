import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import PermissionMatrix, { type MatrixRow } from '@/components/workspace/PermissionMatrix';
import TableSearch from '@/components/workspace/TableSearch';
import { listRoles, permissionMatrix, roleAssignmentHistory } from '@/services/identity/roles';

export const metadata = { title: 'Roles & permissions' };

const stamp = (value: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(value)
    .replace(/\//g, '-')
    .replace(',', '');

const dayOnly = (value: Date | null) =>
  value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric' }).format(value) : null;

/**
 * Roles & permissions, per the reference: the role list on the left with its
 * default badges, slugs and user counts, the selected role's detail on the
 * right (or "Select a role."), then Assign a role, the users holding it, and
 * the assignment history.
 *
 * Roles are data, not code. A user may hold several at once, scoped and dated,
 * and every change here is enforced by the server and written to the audit log.
 */
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

  const [roles, history, memberships, branches, regions] = await Promise.all([
    listRoles(ctx),
    roleAssignmentHistory(ctx, { limit: 100 }),
    prisma.workspaceMembership.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      include: { platformUser: { select: { fullName: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.region.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  const selected = roleId ? await permissionMatrix(ctx, roleId).catch(() => null) : null;

  const now = new Date();
  const holders = selected
    ? await prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          deletedAt: null,
          OR: [
            { roleId: selected.role.id },
            {
              workspaceMembership: {
                roles: {
                  some: {
                    tenantId: ctx.tenantId,
                    roleId: selected.role.id,
                    status: 'ACTIVE',
                    AND: [
                      { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
                      { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
                    ],
                  },
                },
              },
            },
          ],
        },
        select: { id: true, fullName: true, email: true, roleId: true },
        orderBy: { fullName: 'asc' },
        take: 200,
      })
    : [];

  const scopeIdOptions = [
    ...branches.map((branch) => ({ value: branch.id, label: `Branch · ${branch.name}` })),
    ...regions.map((region) => ({ value: region.id, label: `Region · ${region.name}` })),
  ];
  // The list reads alphabetically by display name, as the reference shows.
  const ordered = [...roles].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="lf-page-stack">
      <section>
        <div className="lf-eyebrow">Administration</div>
        <h1 style={{ margin: '8px 0 0' }}>Roles &amp; permissions</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)', maxWidth: '100ch' }}>
          Roles are data, not code. Users can hold several roles at once, scoped to a department, location, project or
          their own team, with optional start and end dates. Every change here is enforced by the server and written to
          the immutable audit log.
        </p>
      </section>

      <div className="lf-roles__split">
        <section className="lf-card lf-roles__list">
          {ordered.map((role) => (
            <Link
              key={role.id}
              href={`?roleId=${role.id}`}
              className="lf-roles__row"
              aria-current={selected?.role.id === role.id ? 'true' : undefined}
            >
              <span className="lf-roles__row-head">
                <strong>{role.name}</strong>
                {role.isSystem && <span className="lf-roles__default">default</span>}
                {!role.isActive && <span className="lf-roles__default">inactive</span>}
              </span>
              <span className="lf-roles__slug">
                {role.key} · {role.users} user{role.users === 1 ? '' : 's'}
              </span>
            </Link>
          ))}
          {mayManage && (
            <div className="lf-roles__list-actions">
              <a className="lf-btn lf-btn--sm" href="#new-role">
                New role
              </a>
              <a className="lf-btn lf-btn--secondary lf-btn--sm" href="#clone-role">
                Clone selected
              </a>
            </div>
          )}
        </section>

        <section className="lf-card lf-roles__detail">
          {!selected ? (
            <p className="lf-roles__placeholder">Select a role.</p>
          ) : (
            <>
              <div className="lf-roles__detail-head">
                <div>
                  <h2 style={{ margin: 0, fontSize: 'var(--lf-text-lg)' }}>{selected.role.name}</h2>
                  <p style={{ margin: '4px 0 0', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
                    {selected.editable
                      ? 'Scopes above your own level are shown but cannot be selected.'
                      : 'This role is at or above your own level, so it is read-only for you.'}
                  </p>
                </div>
                <Link className="lf-btn lf-btn--secondary lf-btn--sm" href="?">
                  Close
                </Link>
              </div>
              <PermissionMatrix
                endpoint={endpoint}
                roleId={selected.role.id}
                editable={mayManage && selected.editable}
                rows={selected.permissions as MatrixRow[]}
              />
            </>
          )}
        </section>
      </div>

      {mayManage && (
        <section id="new-role">
          <h2 className="lf-leave__section">New role</h2>
          <WorkspaceRecordForm
            endpoint={`${endpoint}/create`}
            submitLabel="Create role"
            fields={[
              { name: 'name', label: 'Name', required: true },
              { name: 'key', label: 'Key (lowercase, no spaces)', required: true, placeholder: 'branch_supervisor' },
              { name: 'rank', label: 'Rank', type: 'number', required: true, placeholder: String(ctx.actor.roleRank + 10) },
              {
                name: 'defaultScope',
                label: 'Default scope',
                type: 'select',
                options: ['OWN', 'TEAM', 'BRANCH', 'REGION', 'ORGANIZATION'].map((value) => ({ value, label: value.toLowerCase() })),
              },
              { name: 'description', label: 'Description' },
            ]}
          />
        </section>
      )}

      {mayManage && (
        <section id="clone-role">
          <h2 className="lf-leave__section">Clone selected</h2>
          <WorkspaceRecordForm
            endpoint={`${endpoint}/clone`}
            submitLabel="Clone role"
            fields={[
              {
                name: 'sourceRoleId',
                label: 'Copy from',
                type: 'select',
                required: true,
                options: ordered.map((role) => ({ value: role.id, label: `${role.name} (${role.key})` })),
              },
              { name: 'name', label: 'New role name', required: true },
              { name: 'key', label: 'Key (lowercase, no spaces)', required: true },
              { name: 'rank', label: 'Rank', type: 'number', required: true, placeholder: String(ctx.actor.roleRank + 10) },
            ]}
          />
        </section>
      )}

      {mayManage && (
        <section>
          <h2 className="lf-leave__section">Assign a role</h2>
          <WorkspaceRecordForm
            endpoint={`${endpoint}/assign`}
            submitLabel="Assign role"
            fields={[
              {
                name: 'membershipId',
                label: 'Employee',
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
                options: ordered
                  .filter((role) => role.editable && role.isActive)
                  .map((role) => ({ value: role.id, label: role.name })),
              },
              {
                name: 'scopeType',
                label: 'Scope',
                type: 'select',
                options: [
                  { value: 'ORGANIZATION', label: 'Entire organisation' },
                  { value: 'REGION', label: 'A region' },
                  { value: 'BRANCH', label: 'A branch' },
                  { value: 'TEAM', label: 'Their team' },
                  { value: 'DIRECT_REPORTS', label: 'Their direct reports' },
                  { value: 'OWN_RECORD', label: 'Their own record only' },
                ],
              },
              ...(scopeIdOptions.length
                ? [
                    {
                      name: 'scopeId',
                      label: 'Scope id / name (if scoped)',
                      type: 'select' as const,
                      options: [{ value: '', label: '—' }, ...scopeIdOptions],
                    },
                  ]
                : []),
              { name: 'effectiveFrom', label: 'Start date', type: 'date' },
              { name: 'effectiveTo', label: 'End date', type: 'date' },
            ]}
          />
        </section>
      )}

      <section>
        <h2 className="lf-leave__section">Users holding {selected ? selected.role.name : '…'}</h2>
        {!selected ? (
          <div className="lf-card lf-leave__empty">Select a role.</div>
        ) : holders.length === 0 ? (
          <div className="lf-card lf-leave__empty">Nobody currently holds this role.</div>
        ) : (
          <TableSearch placeholder="Name or email…" label="Search the holders">
          <div className="lf-card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="lf-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Held as</th>
                </tr>
              </thead>
              <tbody>
                {holders.map((holder) => (
                  <tr key={holder.id}>
                    <td data-label="User">{holder.fullName}</td>
                    <td data-label="Email">{holder.email}</td>
                    <td data-label="Held as">
                      <span className="lf-badge">{holder.roleId === selected.role.id ? 'primary role' : 'assignment'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </TableSearch>
        )}
      </section>

      <section>
        <h2 className="lf-leave__section">Assignment history</h2>
        {history.length === 0 ? (
          <div className="lf-card lf-leave__empty">No additional role assignments.</div>
        ) : (
          <TableSearch placeholder="User, role, scope or status…" label="Search the history">
          <div className="lf-card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="lf-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Scope</th>
                  <th>Window</th>
                  <th>Status</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((assignment) => (
                  <tr key={assignment.id}>
                    <td data-label="User">{assignment.holder}</td>
                    <td data-label="Role">{assignment.role.key}</td>
                    <td data-label="Scope">{assignment.scopeType.toLowerCase()}</td>
                    <td data-label="Window">
                      {dayOnly(assignment.effectiveFrom) ?? '—'} → {dayOnly(assignment.effectiveTo) ?? 'open'}
                    </td>
                    <td data-label="Status">
                      <span className="lf-badge">{assignment.inForce ? 'active' : assignment.status.toLowerCase()}</span>
                    </td>
                    <td data-label="When">{stamp(assignment.assignedAt)}</td>
                    <td data-label="">
                      {mayManage && assignment.status === 'ACTIVE' && (
                        <WorkspaceActionButton
                          endpoint={`${endpoint}/revoke`}
                          body={{ assignmentId: assignment.id }}
                          label="Revoke"
                          variant="ghost"
                          promptFor={{ name: 'reason', label: 'Reason', required: false }}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </TableSearch>
        )}
      </section>
    </div>
  );
}
