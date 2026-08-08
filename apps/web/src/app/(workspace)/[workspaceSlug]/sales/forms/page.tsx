import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import Badge, { type Tone } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';

export const metadata = { title: 'Forms' };

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
  ['Archived', 'ARCHIVED'],
] as const;

export default async function FormsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['forms', 'VIEW'] });

  const stateFilter =
    params.state && ['DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED'].includes(params.state)
      ? { state: params.state as any }
      : {};

  const rows = await prisma.form.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null, ...stateFilter },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      key: true,
      purpose: true,
      state: true,
      isPublic: true,
      createdAt: true,
      _count: { select: { fields: true, submissions: true } },
    },
    take: 50,
  });

  return (
    <>
      <ListHeader
        title="Forms"
        description={
          <>
            {rows.length} form{rows.length === 1 ? '' : 's'}
          </>
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="State filter">
        {TABS.map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/forms?state=${key}` : '/forms'}
            aria-selected={(params.state ?? '') === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState title="No forms yet" description="Create a lead capture form to start collecting submissions." />
        </div>
      ) : (
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Purpose</th>
                <th>Fields</th>
                <th>Submissions</th>
                <th>Public</th>
                <th>State</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>{r.name}</td>
                  <td style={{ color: 'var(--lf-ink-3)', fontFamily: 'monospace', fontSize: 'var(--lf-text-sm)' }}>
                    {r.key}
                  </td>
                  <td>{r.purpose.replace(/_/g, ' ').toLowerCase()}</td>
                  <td style={{ textAlign: 'center' }}>{r._count.fields}</td>
                  <td style={{ textAlign: 'center' }}>{r._count.submissions}</td>
                  <td style={{ textAlign: 'center' }}>{r.isPublic ? 'Yes' : 'No'}</td>
                  <td>
                    <Badge tone={STATE_TONE[r.state] ?? 'slate'}>{r.state.toLowerCase()}</Badge>
                  </td>
                  <td style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
                    {new Date(r.createdAt).toLocaleDateString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
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
