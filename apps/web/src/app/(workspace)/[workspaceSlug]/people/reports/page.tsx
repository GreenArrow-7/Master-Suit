import Link from 'next/link';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import { availableReports, runReport, type ReportGroup } from '@/services/hr/reports';

const GROUP_LABELS: Record<ReportGroup, string> = {
  employees: 'People',
  attendance: 'Attendance and overtime',
  leave: 'Leave',
  lifecycle: 'Lifecycle and documents',
  payroll: 'Payroll',
  recruitment: 'Recruitment',
  performance: 'Performance',
};

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ report?: string; from?: string; to?: string }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });

  // Exactly the reports this role may run. The run endpoint and the CSV export
  // re-assert the same permission, so a key typed into the URL still refuses.
  const reports = availableReports(ctx);
  const selected = query.report ? reports.find((report) => report.key === query.report) : undefined;

  const filters = {
    from: query.from ? new Date(query.from) : undefined,
    to: query.to ? new Date(query.to) : undefined,
  };
  const result = selected ? await runReport(ctx, selected.key, filters).catch(() => null) : null;

  const grouped = new Map<ReportGroup, typeof reports>();
  for (const report of reports) {
    grouped.set(report.group, [...(grouped.get(report.group) ?? []), report]);
  }

  const exportHref = selected
    ? `/api/v1/workspaces/${workspaceSlug}/hr/reports/${selected.key}/export${queryString(query)}`
    : '';

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
      <section>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>Reports</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', maxWidth: '78ch' }}>
          Each report carries the permission for the data behind it, not for reporting — so someone who can read
          headcount cannot export salary cost. You are shown {reports.length} of the reports that exist; the rest need
          permissions your role does not have.
        </p>
      </section>

      {reports.length === 0 ? (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)', color: 'var(--lf-ink-600)' }}>
          Your role does not allow any reports yet.
        </section>
      ) : (
        <section style={{ display: 'grid', gap: 'var(--lf-space-5)' }}>
          {[...grouped.entries()].map(([group, list]) => (
            <div key={group}>
              <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 8px' }}>{GROUP_LABELS[group]}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                {list.map((report) => (
                  <Link
                    key={report.key}
                    href={`?report=${report.key}${query.from ? `&from=${query.from}` : ''}${query.to ? `&to=${query.to}` : ''}`}
                    className="lf-card"
                    style={{
                      padding: 'var(--lf-space-4)',
                      textDecoration: 'none',
                      color: 'inherit',
                      borderColor: report.key === selected?.key ? 'var(--lf-accent)' : undefined,
                    }}
                  >
                    <strong>{report.title}</strong>
                    <p style={{ margin: '4px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
                      {report.description}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {selected && (
        <section>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>{selected.title}</h2>
              <p style={{ margin: '4px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
                {result ? `${result.rows.length} rows` : 'Could not run this report.'}
              </p>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {selected.filters.includes('from') && (
                <form style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <input type="hidden" name="report" value={selected.key} />
                  <label className="lf-field">
                    <span className="lf-label">From</span>
                    <input className="lf-input" type="date" name="from" defaultValue={query.from} />
                  </label>
                  <label className="lf-field">
                    <span className="lf-label">To</span>
                    <input className="lf-input" type="date" name="to" defaultValue={query.to} />
                  </label>
                  <button className="lf-btn lf-btn--ghost" type="submit">
                    Apply
                  </button>
                </form>
              )}
              {result && result.rows.length > 0 && (
                <a className="lf-btn" href={exportHref} download>
                  Export CSV
                </a>
              )}
            </div>
          </div>

          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            {result ? (
              <WorkspaceTable
                headers={result.columns.map((column) => column.label)}
                empty="This report returned no rows for the period."
                rows={result.rows.map((row) => result.columns.map((column) => format(row[column.key])))}
              />
            ) : (
              <p style={{ color: 'var(--lf-ink-600)' }}>
                This report could not be run. It may need a permission your role does not have.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** Carries only the filters through to the export, never the report key twice. */
function queryString(query: { from?: string; to?: string }) {
  const parts = [
    query.from ? `from=${encodeURIComponent(query.from)}` : '',
    query.to ? `to=${encodeURIComponent(query.to)}` : '',
  ]
    .filter(Boolean)
    .join('&');
  return parts ? `?${parts}` : '';
}

function format(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (value instanceof Date) return value.toLocaleDateString('en-AE', { timeZone: 'UTC' });
  if (typeof value === 'number') return value.toLocaleString('en-AE', { maximumFractionDigits: 2 });
  return String(value);
}
