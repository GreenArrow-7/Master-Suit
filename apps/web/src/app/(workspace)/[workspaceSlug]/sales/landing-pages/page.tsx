import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import Badge, { type Tone } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import { LandingComposer, LandingRowActions } from './LandingAdmin';

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
  ['Paused', 'PAUSED'],
  ['Archived', 'ARCHIVED'],
] as const;

export default async function LandingPagesPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ state?: string }>;
}) {
  const params = await searchParams;
  const { workspaceSlug } = await routeParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['landingpages', 'VIEW'] });
  const canEdit = can(ctx, 'landingpages', 'CREATE') || can(ctx, 'landingpages', 'MANAGE_CONFIGURATION');

  const stateFilter =
    params.state && ['DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED'].includes(params.state)
      ? { state: params.state as any }
      : {};

  const [rows, forms] = await Promise.all([
    prisma.landingPage.findMany({
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
    }),
    canEdit
      ? prisma.form.findMany({
          where: { tenantId: ctx.tenantId, state: 'PUBLISHED', deletedAt: null },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <ListHeader
        title="Landing Pages"
        description={
          <>
            {rows.length} page{rows.length === 1 ? '' : 's'}
          </>
        }
        actions={canEdit && <LandingComposer forms={forms} />}
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
                {canEdit && <th aria-label="Actions" />}
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
                    {canEdit && (
                      <td>
                        <LandingRowActions id={r.id} slug={r.slug} state={r.state} workspaceSlug={workspaceSlug} />
                      </td>
                    )}
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
