import Link from 'next/link';
import ListHeader from '@/components/workspace/ListHeader';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import { can, SCOPE_RANK } from '@/lib/security/rbac';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import PermissionMatrix, { type MatrixRow } from '@/components/workspace/PermissionMatrix';
import { listRoles, permissionMatrix, roleAssignmentHistory } from '@/services/identity/roles';
import { PRIMARY_TEMPLATE_KEYS } from '@/lib/roles/templates';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';

export const metadata = { title: 'Roles & permissions' };

const scopeLabel = (scope: string) => scope.charAt(0) + scope.slice(1).toLowerCase();

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
  value
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Dubai',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(value)
    : null;

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
    prisma.branch.findMany({
      where: { tenantId: ctx.tenantId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.region.findMany({
      where: { tenantId: ctx.tenantId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
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
  /**
   * Two groups, not one alphabetical list.
   *
   * A workspace can hold the six business roles, Lead Eagle's specialist
   * starter roles and whatever an administrator has built, and alphabetical
   * order buried "Sales Agent" between "Journey Rep" and "Scope probe". The six
   * a brokerage recognises come first, in their own order; everything else
   * follows under Advanced, alphabetically, and nothing is hidden.
   */
  const alphabetical = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const primary = PRIMARY_TEMPLATE_KEYS.map((key) => roles.find((role) => role.key === key)).filter(
    (role): role is (typeof roles)[number] => Boolean(role),
  );
  const advanced = roles.filter((role) => !PRIMARY_TEMPLATE_KEYS.includes(role.key)).sort(alphabetical);
  const groups = [
    { key: 'primary', label: 'Business roles', roles: primary },
    { key: 'advanced', label: 'Advanced & custom roles', roles: advanced },
  ].filter((group) => group.roles.length > 0);
  // Selecting a role still works whichever group it is in.
  const ordered = [...primary, ...advanced];

  return (
    <div className="lf-page-stack">
      <ListHeader
        title={<>Roles &amp; permissions</>}
        description="Manage what each role can access."
        help={
          <p>
            Roles are data, not code. Users can hold several roles at once, scoped to a department, location, project or
            their own team, with optional start and end dates. Every change here is enforced by the server and written
            to the immutable audit log.
          </p>
        }
      />

      <div className="lf-roles__split">
        <section className="lf-card lf-roles__list">
          {groups.map((group) => (
            <div key={group.key} className="lf-roles__group">
              {groups.length > 1 && <div className="lf-roles__group-label">{group.label}</div>}
              {group.roles.map((role) => (
                <Link
                  key={role.id}
                  href={`?roleId=${role.id}`}
                  className="lf-roles__row"
                  aria-current={selected?.role.id === role.id ? 'true' : undefined}
                >
                  <span className="lf-roles__row-head">
                    <strong>{role.name}</strong>
                    {/* The role's own scope, as the roles API returns it (M2-03), and how far its grants reach when wider. */}
                    <span className="lf-roles__scope" title="Default scope, and the widest any permission reaches">
                      · {scopeLabel(role.defaultScope)}
                      {role.widestScope &&
                        SCOPE_RANK[role.widestScope] > SCOPE_RANK[role.defaultScope] &&
                        ` (up to ${scopeLabel(role.widestScope)})`}
                    </span>
                    {role.isSystem && <span className="lf-roles__default">default</span>}
                    {!role.isActive && <span className="lf-roles__default">inactive</span>}
                  </span>
                  {/*
                   * What the role is for, in words. This line used to read the
                   * role's key — `realestate_ops` — which is an implementation
                   * detail standing where the explanation belongs. The key is
                   * still here for an administrator who needs it, on hover and
                   * in the detail panel opposite.
                   */}
                  {role.description && <span className="lf-roles__purpose">{role.description}</span>}
                  <span className="lf-roles__slug" title={`Role key: ${role.key}`}>
                    {role.modules.length
                      ? `${role.modules.length} module${role.modules.length === 1 ? '' : 's'}`
                      : 'No permissions yet'}{' '}
                    · {role.users} user{role.users === 1 ? '' : 's'}
                  </span>
                </Link>
              ))}
            </div>
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
              {/* Keyed by role: navigating between roles changes only a search
                  param, which React reconciles rather than remounting — so
                  without this the matrix kept the previous role's scopes, showed
                  them against the new role's rows, and Save wrote them onto it. */}
              <PermissionMatrix
                key={selected.role.id}
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
              {
                name: 'rank',
                label: 'Rank',
                type: 'number',
                required: true,
                // The server refuses a rank at or above the creator's own; make that the
                // field's constraint rather than a 403 after submit.
                min: ctx.actor.roleRank + 1,
                defaultValue: String(ctx.actor.roleRank + 10),
                hint: `Lower is more senior. Your rank is ${ctx.actor.roleRank}; new roles must be ${ctx.actor.roleRank + 1} or higher.`,
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
              {
                name: 'rank',
                label: 'Rank',
                type: 'number',
                required: true,
                placeholder: String(ctx.actor.roleRank + 10),
              },
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
          <WorkspaceTable
            headers={['User', 'Email', 'Held as']}
            rows={holders.map((holder) => [
              holder.fullName,
              holder.email,
              <span key="held" className="lf-badge">
                {holder.roleId === selected.role.id ? 'primary role' : 'assignment'}
              </span>,
            ])}
            searchable
            searchPlaceholder="Name or email…"
            searchLabel="Search the holders"
          />
        )}
      </section>

      <section>
        <h2 className="lf-leave__section">Assignment history</h2>
        {history.length === 0 ? (
          <div className="lf-card lf-leave__empty">No additional role assignments.</div>
        ) : (
          <div className="lf-card" style={{ padding: 'var(--lf-space-4)' }}>
            <WorkspaceTable
              headers={['User', 'Role', 'Scope', 'Window', 'Status', 'When', { label: '', priority: 'secondary' }]}
              rows={history.map((assignment) => [
                assignment.holder,
                assignment.role.key,
                assignment.scopeType.toLowerCase(),
                `${dayOnly(assignment.effectiveFrom) ?? '—'} → ${dayOnly(assignment.effectiveTo) ?? 'open'}`,
                <span key="status" className="lf-badge">
                  {assignment.inForce ? 'active' : assignment.status.toLowerCase()}
                </span>,
                stamp(assignment.assignedAt),
                mayManage && assignment.status === 'ACTIVE' && (
                  <WorkspaceActionButton
                    endpoint={`${endpoint}/revoke`}
                    body={{ assignmentId: assignment.id }}
                    label="Revoke"
                    variant="ghost"
                    promptFor={{ name: 'reason', label: 'Reason', required: false }}
                  />
                ),
              ])}
              searchable
              searchPlaceholder="User, role, scope or status…"
              searchLabel="Search the history"
            />
          </div>
        )}
      </section>
    </div>
  );
}
