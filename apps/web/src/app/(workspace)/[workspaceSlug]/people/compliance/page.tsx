import { resolveWorkspacePage, pageLoad } from '@/lib/workspace-page';
import PageHeader from '@/components/ui/PageHeader';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import ExportCsv from '@/components/workspace/ExportCsv';
import SalesLink from '@/components/workspace/SalesLink';
import { complianceRegister } from '@/services/hr/compliance';

export const metadata = { title: 'Compliance' };

const SEVERITY_TONE: Record<string, string> = {
  expired: 'var(--lf-vermillion, #b3261e)',
  urgent: 'var(--lf-vermillion, #b3261e)',
  soon: 'var(--lf-brass)',
  watch: 'var(--lf-ink-3)',
};

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const date = (value: Date) => value.toLocaleDateString('en-AE', { timeZone: 'UTC' });

/**
 * The compliance register: every credential expiring across the workforce —
 * visa, Emirates ID, passport, labour card, and the RERA broker card unique to
 * a property business — in one severity-sorted, exportable view.
 */
export default async function CompliancePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ within?: string; contractors?: string }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });

  const within = query.within === '30' || query.within === '60' || query.within === '90' ? Number(query.within) : 90;
  const contractorsOnly = query.contractors === 'true';
  const rows = await pageLoad(complianceRegister(ctx, { withinDays: within, contractorsOnly }));

  const expired = rows.filter((row) => row.severity === 'expired').length;
  const urgent = rows.filter((row) => row.severity === 'urgent').length;

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow="People / HRMS"
        title="Compliance register"
        description="Every work credential expiring soon — visa, Emirates ID, passport, labour card and RERA broker card — worst first. A lapsed credential can stop someone working or selling."
        breadcrumbs={[{ label: 'Workspace', href: `/${workspaceSlug}/dashboard` }, { label: 'People', href: `/${workspaceSlug}/people` }, { label: 'Compliance' }]}
        actions={
          rows.length > 0 ? (
            <ExportCsv
              filename={`compliance-register-${new Date().toISOString().slice(0, 10)}.csv`}
              csv={[
                ['Employee', 'Employee number', 'Employment type', 'Credential', 'Reference', 'Expires', 'Days remaining', 'Severity']
                  .map(csvCell)
                  .join(','),
                ...rows.map((row) =>
                  [row.employeeName, row.employeeNumber, row.employmentType ?? '', row.credential, row.reference ?? '', date(row.expiresAt), row.daysRemaining, row.severity]
                    .map(csvCell)
                    .join(','),
                ),
              ].join('\r\n')}
            />
          ) : undefined
        }
      />

      <div className="lf-metric-grid">
        {(
          [
            ['Expiring within', `${within} days`, undefined],
            ['Expired', expired, expired ? 'bad' : 'ok'],
            ['Urgent (≤30d)', urgent, urgent ? 'warn' : 'ok'],
            ['Total flagged', rows.length, undefined],
          ] as const
        ).map(([label, value, tone]) => (
          <article className="lf-metric-card" key={label}>
            <div className="lf-eyebrow">{label}</div>
            <div
              className="lf-metric-card__value"
              style={tone === 'bad' ? { color: SEVERITY_TONE.expired } : tone === 'warn' ? { color: SEVERITY_TONE.soon } : undefined}
            >
              {value}
            </div>
          </article>
        ))}
      </div>

      <nav className="lf-tabs" aria-label="Filters" style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
        {[30, 60, 90].map((d) => (
          <SalesLink key={d} className="lf-tab" href={`/compliance?within=${d}${contractorsOnly ? '&contractors=true' : ''}`} aria-selected={within === d}>
            {d} days
          </SalesLink>
        ))}
        <SalesLink
          className="lf-tab"
          href={`/compliance?within=${within}${contractorsOnly ? '' : '&contractors=true'}`}
          aria-selected={contractorsOnly}
        >
          {contractorsOnly ? '✓ Contractors only' : 'Contractors only'}
        </SalesLink>
      </nav>

      <WorkspaceTable
        headers={['Employee', 'Type', 'Credential', 'Reference', 'Expires', 'Remaining', 'Severity']}
        empty={contractorsOnly ? 'No contractor credentials expire in this window.' : 'No credentials expire in this window.'}
        rows={rows.map((row) => [
          row.employeeName,
          row.isContractor ? (
            <span className="lf-badge" key="t">
              contractor
            </span>
          ) : (
            (row.employmentType ?? '—')
          ),
          row.credential,
          row.reference ?? '—',
          date(row.expiresAt),
          row.daysRemaining < 0 ? `${Math.abs(row.daysRemaining)}d ago` : `${row.daysRemaining}d`,
          <span key="s" style={{ color: SEVERITY_TONE[row.severity], fontWeight: 600, fontSize: 'var(--lf-text-sm)' }}>
            {row.severity}
          </span>,
        ])}
      />
    </div>
  );
}
