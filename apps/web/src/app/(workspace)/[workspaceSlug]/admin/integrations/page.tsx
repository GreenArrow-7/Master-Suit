import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Integrations' };

const TABS = [
  ['All', ''],
  ['Active', 'active'],
  ['Inactive', 'inactive'],
] as const;

function relativeTime(date: Date | null | undefined): string {
  if (!date) return '—';
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 0) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ permission: ['integrations', 'VIEW'] });

  let activeFilter: Record<string, unknown> = {};
  if (params.tab === 'active') activeFilter = { isActive: true };
  else if (params.tab === 'inactive') activeFilter = { isActive: false };

  const rows = await prisma.integration.findMany({
    where: { tenantId: ctx.tenantId, ...activeFilter },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      key: true,
      category: true,
      authMethod: true,
      isActive: true,
      lastSyncAt: true,
      lastSyncStatus: true,
      lastErrorMessage: true,
    },
    take: 50,
  });

  return (
    <>
      <header
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-4)', marginBottom: 'var(--lf-space-4)' }}
      >
        <div>
          <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)' }}>
            Integrations
          </h1>
          <p style={{ margin: '2px 0 0', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            {rows.length} integration{rows.length === 1 ? '' : 's'}
          </p>
        </div>
      </header>

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Status filter">
        {TABS.map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/integrations?tab=${key}` : '/integrations'}
            aria-selected={(params.tab ?? '') === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="No integrations configured"
            description="Connect third-party services like email, telephony, or marketing tools."
          />
        </div>
      ) : (
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Auth</th>
                <th>Status</th>
                <th>Last Sync</th>
                <th>Sync Status</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>{r.name}</td>
                  <td>{r.category}</td>
                  <td style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>{r.authMethod}</td>
                  <td>
                    <Badge tone={r.isActive ? 'viridian' : 'slate'}>{r.isActive ? 'active' : 'inactive'}</Badge>
                  </td>
                  <td style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
                    {relativeTime(r.lastSyncAt)}
                  </td>
                  <td>
                    {r.lastSyncStatus ? (
                      <Badge
                        tone={
                          r.lastSyncStatus === 'SUCCESS'
                            ? 'viridian'
                            : r.lastSyncStatus === 'PARTIAL'
                              ? 'brass'
                              : 'vermillion'
                        }
                      >
                        {r.lastSyncStatus.toLowerCase()}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td
                    style={{
                      color: 'var(--lf-vermillion)',
                      fontSize: 'var(--lf-text-sm)',
                      maxWidth: 200,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.lastErrorMessage ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
