import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import Badge, { type Tone } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';

export const metadata = { title: 'Landing Pages' };

const STATE_TONE: Record<string, Tone> = {
  DRAFT: 'slate',
  PUBLISHED: 'viridian',
  PAUSED: 'brass',
  ARCHIVED: 'slate',
};
const TABS = [
  ['All', ''],
  ['Published', 'PUBLISHED'],
  ['Draft', 'DRAFT'],
] as const;

export default async function LandingPagesPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['landingpages', 'VIEW'] });

  const stateFilter =
    params.state && ['DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED'].includes(params.state)
      ? { state: params.state as any }
      : {};

  const rows = await prisma.landingPage.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null, ...stateFilter },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
      state: true,
      customDomain: true,
      visitCount: true,
      submissionCount: true,
      publishedAt: true,
      createdAt: true,
    },
    take: 50,
  });

  return (
    <>
      <ListHeader
        title="Landing Pages"
        description={
          <>
            {rows.length} page{rows.length === 1 ? '' : 's'}
          </>
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="State filter">
        {TABS.map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/landing-pages?state=${key}` : '/landing-pages'}
            aria-selected={(params.state ?? '') === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="No landing pages yet"
            description="Create a landing page to capture leads from campaigns."
          />
        </div>
      ) : (
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Domain</th>
                <th>Visits</th>
                <th>Submissions</th>
                <th>Conv. Rate</th>
                <th>State</th>
                <th>Published</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rate = r.visitCount > 0 ? ((r.submissionCount / r.visitCount) * 100).toFixed(1) : '—';
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    <td style={{ color: 'var(--lf-ink-3)', fontFamily: 'monospace', fontSize: 'var(--lf-text-sm)' }}>
                      /{r.slug}
                    </td>
                    <td style={{ color: 'var(--lf-ink-2)' }}>{r.customDomain ?? '—'}</td>
                    <td style={{ textAlign: 'center' }}>{r.visitCount.toLocaleString()}</td>
                    <td style={{ textAlign: 'center' }}>{r.submissionCount.toLocaleString()}</td>
                    <td style={{ textAlign: 'center' }}>{rate === '—' ? '—' : `${rate}%`}</td>
                    <td>
                      <Badge tone={STATE_TONE[r.state] ?? 'slate'}>{r.state.toLowerCase()}</Badge>
                    </td>
                    <td style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
                      {r.publishedAt
                        ? new Date(r.publishedAt).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
