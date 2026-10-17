import { requirePageAccess } from '@/lib/workspace-page';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { can } from '@/lib/security/rbac';
import { PIVOTS, runReport, REPORT_KEYS, type Pivot, type ReportKey } from '@/services/leadership/reports';
import { listSchedules } from '@/services/leadership/reportSchedules';
import { workspaceTimezone } from '@/services/hr/attendance';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import SalesLink from '@/components/workspace/SalesLink';
import { ScheduleForm, ScheduleList } from './ReportSchedules';

export const metadata = { title: 'Reports' };

const REPORTS = [
  {
    category: 'Sales Performance',
    items: [
      {
        key: 'lead-conversion',
        icon: '📊',
        title: 'Lead Conversion Rate',
        desc: 'How leads move through stages to conversion.',
      },
      {
        key: 'pipeline-summary',
        icon: '📈',
        title: 'Sales Pipeline Summary',
        desc: 'Stage distribution and open pipeline value.',
      },
      { key: 'activity-log', icon: '📋', title: 'Activity Log Report', desc: 'Logged activities by type and user.' },
      {
        key: 'revenue-forecast',
        icon: '💰',
        title: 'Revenue Forecast',
        desc: 'Open pipeline weighted by each deal’s probability.',
      },
      {
        key: 'project-report',
        icon: '🏗️',
        title: 'Projects',
        desc: 'Units and availability, the leads each project drew, its visits and bookings.',
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
        desc: 'Leads, activities, bookings and value per person.',
      },
      {
        key: 'rep-activity',
        icon: '🏃',
        title: 'Rep Activity Summary',
        desc: 'Activity counts and average first response.',
      },
      {
        key: 'follow-up-adherence',
        icon: '⏰',
        title: 'Follow-up Adherence',
        desc: 'Follow-ups done on time, late or still overdue, by agent.',
      },
      {
        key: 'lead-assignment',
        icon: '🔀',
        title: 'Lead Assignment Report',
        desc: 'Who received leads, and how they were assigned.',
      },
      {
        key: 'site-visits',
        icon: '🚗',
        title: 'Site Visits',
        desc: 'Visits scheduled, done and missed, and the show rate, by agent, project or month.',
      },
      {
        key: 'call-report',
        icon: '📞',
        title: 'Call Report',
        desc: 'Calls, connected calls and talk time, by agent, lead or month.',
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
        desc: 'Lead volume and conversion by campaign.',
      },
      {
        key: 'source-to-booking',
        icon: '🎯',
        title: 'Source to Booking',
        desc: 'Each source and portal, from leads through site visits to bookings and value.',
      },
      {
        key: 'source-analysis',
        icon: '🔍',
        title: 'Source Analysis',
        desc: 'Lead volume and conversion by source channel.',
      },
      {
        key: 'lead-quality',
        icon: '⭐',
        title: 'Lead Quality by Source',
        desc: 'Average score, conversion and response per source.',
      },
    ],
  },
] as const;

const PIVOT_LABEL: Record<Pivot, string> = { user: 'agent', month: 'month', project: 'project', lead: 'lead' };

const isReportKey = (value: string | undefined): value is ReportKey =>
  value !== undefined && (REPORT_KEYS as readonly string[]).includes(value);

/**
 * The report menu, and the reports behind it.
 *
 * Every card used to link to `?report=…` with nothing handling the parameter,
 * and to a path missing the workspace slug — so the menu advertised ten reports
 * and delivered a 404. Both are fixed here: the parameter selects a report and
 * the links are workspace-relative like the rest of the app.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; from?: string; to?: string; by?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['reports', 'VIEW'] });

  const to = params.to ? new Date(params.to) : new Date();
  const from = params.from ? new Date(params.from) : new Date(to.getFullYear(), to.getMonth() - 2, 1);
  const range = { from, to };

  const selected = isReportKey(params.report) ? params.report : null;
  const pivots = (selected && PIVOTS[selected]) || [];
  const by = pivots.find((p) => p === params.by);
  const report = selected ? await runReport(ctx, selected, range, { by }) : null;
  const mayExport = can(ctx, 'reports', 'EXPORT');

  const period = `${from.toLocaleDateString('en-GB', { dateStyle: 'medium' })} to ${to.toLocaleDateString('en-GB', { dateStyle: 'medium' })}`;

  if (report) {
    const query = new URLSearchParams({ report: report.key, from: from.toISOString(), to: to.toISOString() });
    const grouped = (pivot: Pivot) => `/reports?${query}&by=${pivot}`;

    return (
      <>
        <ListHeader
          title={report.title}
          description={period}
          actions={
            <>
              {mayExport && (
                <a
                  className="lf-btn lf-btn--secondary lf-btn--sm"
                  href={`/api/v1/reports?${query}${by ? `&by=${by}` : ''}&format=csv`}
                >
                  Export CSV
                </a>
              )}
              <SalesLink className="lf-btn lf-btn--secondary lf-btn--sm" href="/reports">
                All reports
              </SalesLink>
            </>
          }
        />

        {pivots.length > 0 && (
          <nav className="lf-chips" aria-label="Group by" style={{ marginBottom: 'var(--lf-space-3)' }}>
            {pivots.map((pivot) => (
              <SalesLink
                key={pivot}
                className="lf-chip"
                href={grouped(pivot)}
                aria-current={(by ?? pivots[0]) === pivot ? 'page' : undefined}
              >
                {`By ${PIVOT_LABEL[pivot]}`}
              </SalesLink>
            ))}
          </nav>
        )}

        {report.note && (
          <p className="lf-hint" style={{ marginBottom: 'var(--lf-space-3)' }}>
            {report.note}
          </p>
        )}

        {report.rows.length === 0 ? (
          <div className="lf-card">
            <EmptyState
              title="Nothing in this period"
              description="Widen the dates or check back once there is activity."
            />
          </div>
        ) : (
          <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
            <table className="lf-grid">
              <thead>
                <tr>
                  {report.columns.map((c) => (
                    <th key={c.key} style={c.align === 'right' ? { textAlign: 'right' } : undefined}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, i) => (
                  <tr key={i}>
                    {report.columns.map((c) => (
                      <td
                        key={c.key}
                        className={c.align === 'right' ? 'lf-num' : undefined}
                        style={c.align === 'right' ? { textAlign: 'right' } : undefined}
                      >
                        {/* A blank cell is "not known", which is not the same
                            as zero and must not render as one. */}
                        {row[c.key] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {mayExport && <ScheduleForm report={report.key} by={by} email={ctx.actor.email} />}
      </>
    );
  }

  const schedules = mayExport ? await listSchedules(ctx) : [];
  const zone = schedules.length > 0 ? await workspaceTimezone(ctx) : 'UTC';
  const titles = new Map<string, string>(REPORTS.flatMap((g) => g.items.map((r) => [r.key, r.title] as const)));

  return (
    <>
      <ListHeader title="Reports" description={`Pre-built reports · ${period}`} />

      {schedules.length > 0 && (
        <ScheduleList
          schedules={schedules.map((s) => ({
            id: s.id,
            title: `${titles.get(s.report) ?? s.report}${s.by ? ` by ${PIVOT_LABEL[s.by as Pivot]}` : ''}`,
            cadence: s.cadence,
            recipients: s.recipients,
            next: s.nextRunAt.toLocaleString('en-GB', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }),
          }))}
        />
      )}

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
              <SalesLink
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
                </div>
              </SalesLink>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
