import Link from 'next/link';
import { withPlatformTx } from '@/lib/db';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import OpenWorkspaceButton from '@/components/platform/OpenWorkspaceButton';
import PlatformRowActions from '@/components/platform/PlatformRowActions';

export default async function WorkspacesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = q?.trim();

  // Matches what the row actually shows — the company name and the slug — so a
  // search that finds nothing is a search whose term is not on this screen.
  const search = query
    ? {
        OR: [
          { displayName: { contains: query, mode: 'insensitive' as const } },
          { slug: { contains: query, mode: 'insensitive' as const } },
        ],
      }
    : {};

  // Platform reads span every tenant, so they run with app.platform_admin set.
  // Without it the RLS policies match no rows and the console reported zero
  // employees, no modules and no subscriptions for perfectly healthy workspaces.
  const workspaces = await withPlatformTx((tx) =>
    tx.tenant.findMany({
      where: { deletedAt: null, ...search },
      include: {
        subscription: { include: { plan: true } },
        moduleEntitlements: true,
        _count: { select: { memberships: true, employeeProfiles: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="Customers"
        title="Workspaces"
        description="Manage companies, enabled modules, usage limits and subscription status."
        breadcrumbs={[{ label: 'Platform', href: '/platform' }, { label: 'Workspaces' }]}
        actions={
          <Link href="/platform/workspaces/new" className="lf-btn">
            Create workspace
          </Link>
        }
      />
      {/* The server filter already existed, driven only by the top bar's box.
          An operator standing on this page could not see that search was
          possible, so the control now lives where the list is. */}
      <form className="lf-card lf-filters" method="get" role="search">
        <div className="lf-field lf-filters__search">
          <label className="lf-label" htmlFor="ws-q">
            Search workspaces
          </label>
          <input
            id="ws-q"
            className="lf-input"
            name="q"
            type="search"
            defaultValue={query ?? ''}
            placeholder="Company name or slug"
          />
        </div>
        <button className="lf-btn" type="submit">
          Search
        </button>
        {query && (
          <Link className="lf-btn lf-btn--ghost" href="/platform/workspaces">
            Clear
          </Link>
        )}
      </form>
      {workspaces.length === 0 ? (
        <EmptyState
          title={query ? `Nothing matches "${query}"` : 'No workspaces yet'}
          description={
            query
              ? 'Search covers the company name and the slug shown in this table.'
              : 'Every customer company on this platform appears here once it is provisioned.'
          }
          actionLabel={query ? undefined : 'Create workspace'}
          actionHref={query ? undefined : '/platform/workspaces/new'}
        />
      ) : (
        <section className="lf-table-wrap">
          <table className="lf-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Modules</th>
                <th>Members</th>
                <th>Employees</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((workspace) => (
                <tr key={workspace.id}>
                  <td>
                    <Link href={`/platform/workspaces/${workspace.id}`}>
                      <strong>{workspace.displayName}</strong>
                    </Link>
                    <div style={{ color: 'var(--lf-ink-500)', fontSize: 'var(--lf-text-xs)' }}>{workspace.slug}</div>
                  </td>
                  <td>
                    <span className="lf-badge">{workspace.status}</span>
                  </td>
                  <td>{workspace.subscription?.plan.name ?? workspace.planCode}</td>
                  <td>{workspace.moduleEntitlements.map((item) => item.module).join(' + ') || 'None'}</td>
                  <td className="lf-num">{workspace._count.memberships}</td>
                  <td className="lf-num">{workspace._count.employeeProfiles}</td>
                  <td>{workspace.createdAt.toLocaleDateString('en-AE')}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
                      <OpenWorkspaceButton workspaceId={workspace.id} />
                      <Link className="lf-btn lf-btn--secondary" href={`/platform/workspaces/${workspace.id}`}>
                        Edit
                      </Link>
                      <PlatformRowActions
                        endpoint={`/api/v1/platform/workspaces/${workspace.id}`}
                        fields={[]}
                        deleteLabel="Delete"
                        deleteWarning={`Deletes ${workspace.displayName}: access stops, sessions are revoked and the subscription is cancelled. Data is retained for restore by support.`}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
