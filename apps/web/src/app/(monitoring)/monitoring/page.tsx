import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireMonitoringPage } from '@/lib/monitoring-page';
import { activeCoverage, activeCrmMonitoring, authorizedTenantIds } from '@/lib/auth/platform-access';
import OpenWorkspaceButton from '@/components/platform/OpenWorkspaceButton';
import EmptyState from '@/components/ui/EmptyState';

export const metadata = { title: 'Monitoring' };

/** One page of workspaces: enough to scan, small enough to render on a phone. */
const PAGE_SIZE = 25;

/**
 * Where a monitoring identity lands after signing in: the workspaces they are
 * authorised for, and nothing else.
 *
 * The control plane's own list at `/platform/workspaces` is every workspace on
 * the platform, because provisioning and billing need it. That is a different
 * question from "which customers may this person look at", and conflating the
 * two is what let any platform OWNER open any workspace. Administering a
 * workspace and entering it are separate authorities — `enter` re-asks this same
 * question server-side, so a workspace omitted here cannot be reached by typing
 * its id either.
 *
 * ── Three ways this list gets its scope ─────────────────────────────────────
 *
 * 1. A standing **CRM monitoring entitlement**: every ACTIVE workspace, including
 *    ones created after the grant was issued, because the filter is omitted
 *    rather than built from a list of ids captured at grant time.
 * 2. **Operational coverage**: the same breadth, for an incident, and far
 *    shorter. Named separately so the reader can tell which one they are
 *    relying on and when it ends.
 * 3. **Per-workspace grants**: those workspaces and no others.
 *
 * The scope is re-derived on every request, so revoking any of them removes the
 * workspaces on the next navigation rather than when the session expires.
 */
export default async function MonitoringHome(props: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await requireMonitoringPage();
  const params = await props.searchParams;
  const query = (params.q ?? '').trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  type Scope = {
    allowed: string[] | null;
    entitlement: Awaited<ReturnType<typeof activeCrmMonitoring>>;
    coverage: Awaited<ReturnType<typeof activeCoverage>>;
  };
  let scope: Scope;
  let workspaces: { id: string; slug: string; displayName: string; status: string }[];
  let total: number;

  /**
   * A failure here must never render as "no workspaces".
   *
   * An empty list and an unreachable database look identical once both are an
   * empty array, and the first of those tells somebody their access was taken
   * away. So this either produces a list or says plainly that it could not.
   */
  try {
    const [allowed, entitlement, coverage] = await Promise.all([
      authorizedTenantIds(ctx.platformUserId),
      activeCrmMonitoring(ctx.platformUserId),
      activeCoverage(ctx.platformUserId),
    ]);
    scope = { allowed, entitlement, coverage };

    /**
     * `null` means every workspace, so the id filter is omitted rather than
     * built from a list of every tenant id. An empty array means no grants, and
     * `{ in: [] }` correctly matches nothing — the case that must not
     * accidentally become "everything".
     *
     * Lifecycle, stated rather than implied: only ACTIVE, never-deleted
     * workspaces are listed. A suspended or archived workspace is not one
     * anybody should be watching and a deleted one is gone; `mayEnterWorkspace`
     * and `enter` apply the same rule, so none is reachable by typing an id.
     */
    const where = {
      deletedAt: null,
      status: 'ACTIVE' as const,
      ...(allowed ? { id: { in: allowed } } : {}),
      ...(query
        ? {
            OR: [
              { displayName: { contains: query, mode: 'insensitive' as const } },
              { slug: { contains: query, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    [workspaces, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        select: { id: true, slug: true, displayName: true, status: true },
        orderBy: { displayName: 'asc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.tenant.count({ where }),
    ]);
  } catch {
    return (
      <div style={{ display: 'grid', gap: 18 }}>
        <h1>Monitoring</h1>
        <EmptyState
          title="The workspace list could not be loaded"
          description="This is a fault on our side, not a change to your access. Try again; if it keeps happening the platform team should look at it."
        />
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const until = (date: Date) => date.toISOString().slice(0, 16).replace('T', ' ');
  const href = (next: number) =>
    `/monitoring?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(next) })}`;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <h1>Monitoring</h1>
        <p className="lf-muted" data-testid="monitoring-scope">
          {scope.entitlement
            ? `Platform-wide CRM monitoring until ${until(scope.entitlement.expiresAt)} — ${scope.entitlement.reason}`
            : scope.coverage
              ? `Coverage of every workspace until ${until(scope.coverage.expiresAt)} — ${scope.coverage.reason}`
              : `${total} workspace${total === 1 ? '' : 's'} you are authorised for.`}
        </p>
      </div>

      {/* A plain GET form: the search survives a reload, is linkable, and works
          before any JavaScript has run. */}
      <form method="GET" action="/monitoring" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="lf-input"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search workspaces…"
          aria-label="Search workspaces"
          style={{ flex: '1 1 220px', minWidth: 0 }}
        />
        <button className="lf-btn" type="submit">
          Search
        </button>
        {query ? (
          <Link className="lf-btn lf-btn--secondary" href="/monitoring">
            Clear
          </Link>
        ) : null}
      </form>

      {total === 0 ? (
        query ? (
          <EmptyState
            title="No workspace matches that search"
            description="Check the spelling, or clear the search to see everything you are authorised for."
          />
        ) : scope.allowed === null ? (
          <EmptyState
            title="No active workspaces yet"
            description="Your authorisation covers every workspace. There are none active right now; any workspace created later appears here on its own."
          />
        ) : (
          <EmptyState
            title="No workspaces authorised"
            description="Monitoring access is granted by the platform owner, either for a named workspace or as platform-wide CRM monitoring. Ask for what you need; the reason is recorded with the grant."
          />
        )
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="lf-table" data-testid="monitoring-workspaces">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Slug</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {workspaces.map((workspace) => (
                  <tr key={workspace.id} data-slug={workspace.slug}>
                    <td>{workspace.displayName}</td>
                    <td className="lf-muted">{workspace.slug}</td>
                    <td>{workspace.status}</td>
                    <td style={{ textAlign: 'right' }}>
                      <OpenWorkspaceButton workspaceId={workspace.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <nav
              aria-label="Pages"
              style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
              data-testid="monitoring-pagination"
            >
              {page > 1 && (
                <Link className="lf-btn lf-btn--secondary" href={href(page - 1)}>
                  Previous
                </Link>
              )}
              <span className="lf-muted">
                Page {page} of {pages} · {total} workspaces
              </span>
              {page < pages && (
                <Link className="lf-btn lf-btn--secondary" href={href(page + 1)}>
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
