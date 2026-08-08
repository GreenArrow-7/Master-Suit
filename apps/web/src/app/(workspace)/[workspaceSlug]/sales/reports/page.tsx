import { requirePageAccess } from '@/lib/workspace-page';
import ListHeader from '@/components/workspace/ListHeader';
export const metadata = { title: 'Reports' };

const REPORTS = [
  {
    category: 'Sales Performance',
    items: [
      {
        key: 'lead-conversion',
        icon: '📊',
        title: 'Lead Conversion Rate',
        desc: 'Track how leads move through stages to conversion.',
      },
      {
        key: 'pipeline-summary',
        icon: '📈',
        title: 'Sales Pipeline Summary',
        desc: 'Overview of pipeline value and stage distribution.',
      },
      {
        key: 'activity-log',
        icon: '📋',
        title: 'Activity Log Report',
        desc: 'All logged activities by type, user, and date.',
      },
      {
        key: 'revenue-forecast',
        icon: '💰',
        title: 'Revenue Forecast',
        desc: 'Projected revenue based on pipeline and conversion rates.',
      },
    ],
  },
  {
    category: 'Team & Users',
    items: [
      {
        key: 'team-performance',
        icon: '👥',
        title: 'Team Performance',
        desc: 'Compare team metrics across leads, tasks, and activities.',
      },
      {
        key: 'rep-activity',
        icon: '🏃',
        title: 'Rep Activity Summary',
        desc: 'Individual rep activity counts and response times.',
      },
      {
        key: 'lead-assignment',
        icon: '🔀',
        title: 'Lead Assignment Report',
        desc: 'Assignment distribution and round-robin history.',
      },
    ],
  },
  {
    category: 'Marketing',
    items: [
      {
        key: 'campaign-performance',
        icon: '📣',
        title: 'Campaign Performance',
        desc: 'Lead generation and conversion by campaign.',
      },
      {
        key: 'source-analysis',
        icon: '🔍',
        title: 'Source Analysis',
        desc: 'Lead volume and quality breakdown by source channel.',
      },
      {
        key: 'lead-quality',
        icon: '⭐',
        title: 'Lead Quality by Source',
        desc: 'Average scores and conversion rates per source.',
      },
    ],
  },
];

export default async function ReportsPage() {
  await requirePageAccess({ module: 'SALES', permission: ['reports', 'VIEW'] });

  return (
    <>
      <ListHeader title="Reports" description="Pre-built reports for sales, team, and marketing insights" />

      {REPORTS.map((group) => (
        <section key={group.category} style={{ marginBottom: 'var(--lf-space-6)' }}>
          <h2 className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
            {group.category}
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 'var(--lf-space-3)',
            }}
          >
            {group.items.map((r) => (
              <a
                key={r.key}
                href={`/reports?report=${r.key}`}
                className="lf-card"
                style={{
                  padding: 'var(--lf-space-4)',
                  display: 'flex',
                  gap: 'var(--lf-space-3)',
                  alignItems: 'flex-start',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <span style={{ fontSize: '1.5rem', lineHeight: 1, flexShrink: 0 }}>{r.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--lf-text-sm)' }}>{r.title}</div>
                  <div style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)', marginTop: 2 }}>{r.desc}</div>
                  <span className="lf-badge" data-tone="slate" style={{ marginTop: 8, display: 'inline-block' }}>
                    {group.category}
                  </span>
                </div>
              </a>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
