import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import SalesLink from '@/components/workspace/SalesLink';
import UserRowActions from './UserRowActions';

export const metadata = { title: 'Users' };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

/**
 * The user directory, per the reference: the filter bar, the "N PERSON" count
 * pill, and one row per account carrying the avatar, name and email, biometric
 * consent state, employee code, role, and the two administrator actions.
 *
 * You can only administer accounts at or below your own level — the row actions
 * are hidden for anyone senior, and the server refuses them regardless.
 */
export default async function UsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ q?: string; role?: string; show?: string }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const ctx = await requirePageAccess({ permission: ['users', 'VIEW'] });
  if (!can(ctx, 'users', 'VIEW')) redirect('/home');

  const search = (query.q ?? '').trim();
  const showAll = query.show === 'all';

  const [rows, roles] = await Promise.all([
    prisma.user.findMany({
      where: {
        tenantId: ctx.tenantId,
        deletedAt: null,
        ...(showAll ? {} : { status: 'ACTIVE' }),
        ...(query.role ? { role: { key: query.role } } : {}),
        ...(search
          ? {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' as const } },
                { email: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        fullName: true,
        email: true,
        status: true,
        roleId: true,
        role: { select: { key: true, name: true, rank: true } },
        workspaceMembership: {
          select: {
            id: true,
            employee: { select: { id: true, employeeNumber: true } },
          },
        },
      },
      take: 200,
    }),
    prisma.role.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { rank: 'asc' },
      select: { key: true, name: true },
    }),
  ]);

  // Consent is per employee; one query rather than one per row.
  const employeeIds = rows.map((row) => row.workspaceMembership?.employee?.id).filter((id): id is string => !!id);
  const consents = employeeIds.length
    ? await prisma.biometricConsent.findMany({
        where: { tenantId: ctx.tenantId, employeeId: { in: employeeIds }, grantedAt: { not: null }, withdrawnAt: null },
        select: { employeeId: true },
      })
    : [];
  const consented = new Set(consents.map((row) => row.employeeId));
  const mayManage = can(ctx, 'users', 'MANAGE_USERS');
  // Removal is its own grant, so a workspace can let somebody reset passwords
  // without letting them delete the account. The route checks it again.
  const mayDelete = can(ctx, 'users', 'DELETE');

  return (
    <div className="lf-page-stack">
      <section>
        <div className="lf-eyebrow">Administration</div>
        <h1 style={{ margin: '8px 0 0' }}>Users</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)', maxWidth: '90ch' }}>
          Everyone with an account. Roles decide what each person can reach — you can only administer accounts at or
          below your own level.
        </p>
      </section>

      <form className="lf-card lf-users__filters" method="get">
        <div className="lf-field" style={{ flex: '1 1 280px', margin: 0 }}>
          <label className="lf-label" htmlFor="u-q">
            Search
          </label>
          <input
            id="u-q"
            className="lf-input"
            name="q"
            defaultValue={search}
            placeholder="Name, email or employee code"
          />
        </div>
        <div className="lf-field" style={{ margin: 0 }}>
          <label className="lf-label" htmlFor="u-role">
            Role
          </label>
          <select id="u-role" className="lf-input" name="role" defaultValue={query.role ?? ''}>
            <option value="">All roles</option>
            {roles.map((role) => (
              <option key={role.key} value={role.key}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        <div className="lf-field" style={{ margin: 0 }}>
          <label className="lf-label" htmlFor="u-show">
            Show
          </label>
          <select id="u-show" className="lf-input" name="show" defaultValue={showAll ? 'all' : 'active'}>
            <option value="active">Active only</option>
            <option value="all">Everyone</option>
          </select>
        </div>
        <button className="lf-btn lf-btn--secondary" type="submit">
          Filter
        </button>
        {mayManage && (
          <SalesLink className="lf-btn" href="/users/new">
            + Add user
          </SalesLink>
        )}
      </form>

      <div className="lf-users__head">
        <h2 style={{ margin: 0, fontSize: 'var(--lf-text-lg)' }}>Directory</h2>
        <span className="lf-users__count">
          {rows.length} {rows.length === 1 ? 'person' : 'people'}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="lf-card lf-leave__empty">Nobody matches those filters.</div>
      ) : (
        <div className="lf-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="lf-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Employee code</th>
                <th>Role</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const employee = row.workspaceMembership?.employee;
                const hasConsent = employee ? consented.has(employee.id) : false;
                const administrable = mayManage && row.role.rank > ctx.actor.roleRank && row.id !== ctx.actor.id;
                return (
                  <tr key={row.id}>
                    <td data-label="Name">
                      <span className="lf-users__person">
                        <span className="lf-avatar">{initials(row.fullName)}</span>
                        <span>
                          <SalesLink href={`/users/${row.id}`} className="lf-users__name">
                            {row.fullName}
                          </SalesLink>
                          <span className="lf-users__email">{row.email}</span>
                          {employee && (
                            <span className="lf-users__consent" data-on={hasConsent}>
                              {hasConsent ? 'Face consent' : 'No face consent'}
                            </span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td data-label="Employee code">{employee?.employeeNumber ?? '—'}</td>
                    <td data-label="Role">
                      <span className="lf-users__role">{row.role.name}</span>
                    </td>
                    <td data-label="">
                      {administrable && (
                        <UserRowActions
                          endpoint={`/api/v1/workspaces/${workspaceSlug}/identity`}
                          userId={row.id}
                          userName={row.fullName}
                          employeeId={employee?.id ?? null}
                          workspaceSlug={workspaceSlug}
                          mayDelete={mayDelete}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
