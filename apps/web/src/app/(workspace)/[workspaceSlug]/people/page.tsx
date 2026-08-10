import Link from 'next/link';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import PageHeader from '@/components/ui/PageHeader';
import { isHrAdmin } from '@/services/hr/access';
import { loadDashboard, type Stat } from '@/services/hr/dashboard';

/**
 * The People landing is genuinely different per role (real-estate HRMS §5): an
 * HR administrator, a site manager, payroll, a recruiter, IT, an auditor and an
 * ordinary employee each get their own dashboard, resolved from server-side
 * permissions in loadDashboard — not the same page with cards hidden.
 */
export default async function PeopleOverview({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });
  const dashboard = await loadDashboard(ctx);
  const base = `/${workspaceSlug}/people`;
  const href = (h?: string) => (h ? `${base}/${h}` : undefined);

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="People / HRMS"
        title={dashboard.title}
        description={dashboard.lede}
        breadcrumbs={[{ label: 'Workspace', href: `/${workspaceSlug}/dashboard` }, { label: 'People' }]}
        actions={
          isHrAdmin(ctx) ? (
            <Link className="lf-btn" href={`${base}/employees/new`}>
              Add employee
            </Link>
          ) : undefined
        }
      />

      <div className="lf-metric-grid">
        {dashboard.stats.map((stat) => (
          <StatCard key={stat.label} stat={stat} href={href(stat.href)} />
        ))}
      </div>

      {dashboard.sections.map((section) => (
        <section key={section.heading} className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--lf-space-3)' }}>
            <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>{section.heading}</h2>
            {section.href && (
              <Link className="lf-link" href={href(section.href)!}>
                View all
              </Link>
            )}
          </div>
          {section.rows.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>{section.empty}</p>
          ) : (
            <div style={{ display: 'grid', gap: 2 }}>
              {section.rows.map((row, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--lf-space-3)',
                    padding: '9px 0',
                    borderBottom: '1px solid var(--lf-line)',
                  }}
                >
                  <span style={{ fontWeight: 500, fontSize: 'var(--lf-text-sm)' }}>{row.primary}</span>
                  {row.secondary && (
                    <span style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-2xs)' }}>{row.secondary}</span>
                  )}
                  {row.badge && (
                    <span className="lf-badge" style={{ marginLeft: 'auto' }}>
                      {row.badge}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

const TONE_COLOR: Record<NonNullable<Stat['tone']>, string> = {
  ok: 'var(--lf-viridian)',
  warn: 'var(--lf-brass)',
  bad: 'var(--lf-vermillion, #b3261e)',
  muted: 'var(--lf-ink-3)',
};

function StatCard({ stat, href }: { stat: Stat; href?: string }) {
  const body = (
    <article className="lf-metric-card" style={{ height: '100%' }}>
      <div className="lf-eyebrow">{stat.label}</div>
      <div className="lf-metric-card__value" style={stat.tone ? { color: TONE_COLOR[stat.tone] } : undefined}>
        {stat.value}
      </div>
      {stat.hint && <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>{stat.hint}</div>}
    </article>
  );
  return href ? (
    <Link href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
      {body}
    </Link>
  ) : (
    body
  );
}
