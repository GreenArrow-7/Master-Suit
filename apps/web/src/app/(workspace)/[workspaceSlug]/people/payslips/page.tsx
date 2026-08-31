import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import { compensationHistory, payslipsFor } from '@/services/hr/payroll';
import { myEmployee } from '@/services/hr/leave';

/**
 * An employee's own pay.
 *
 * Gated on `employee:VIEW`, not `payroll:VIEW`, because reading your own payslip
 * is self-service — §87. `payslipsFor` is what enforces the boundary: without
 * `payroll:VIEW` it returns your own record and only from runs that have been
 * approved, so a draft figure that may still change is never shown as if it were
 * final.
 */
export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });

  const self = await myEmployee(ctx);
  const [payslips, compensation] = await Promise.all([
    payslipsFor(ctx),
    self ? compensationHistory(ctx, self.id).catch(() => []) : [],
  ]);

  if (!self) {
    return (
      <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
        <h1 style={{ margin: 0 }}>My pay</h1>
        <p style={{ color: 'var(--lf-ink-2)' }}>
          Your account has no employee record in this workspace, so there is nothing to show here. Ask HR to create one.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
      <section>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>My pay</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)' }}>
          Payslips appear once the payroll run they belong to has been approved.
        </p>
      </section>

      {payslips.map((payslip) => (
        <section className="lf-card" key={payslip.id} style={{ padding: 'var(--lf-space-5)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div className="lf-eyebrow">
                {date(payslip.run.periodStart)} – {date(payslip.run.periodEnd)}
              </div>
              <div style={{ fontFamily: 'var(--lf-font-display)', fontSize: 28, marginTop: 4 }}>
                {money(payslip.netPay, payslip.currency)}
              </div>
              <div style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)' }}>
                net · {payslip.run.status.toLowerCase().replace('_', ' ')}
              </div>
              <a
                className="lf-btn lf-btn--ghost"
                style={{ marginTop: 8, display: 'inline-block' }}
                href={`/api/v1/workspaces/${workspaceSlug}/hr/payslips/${payslip.id}/pdf`}
              >
                Download PDF
              </a>
            </div>
            <div style={{ minWidth: 280, flex: 1 }}>
              <WorkspaceTable
                headers={['Component', 'Amount']}
                rows={payslip.lines.map((line) => [
                  `${line.label}${line.kind === 'DEDUCTION' ? ' (deduction)' : ''}`,
                  `${line.kind === 'DEDUCTION' ? '−' : ''}${money(line.amount, payslip.currency)}`,
                ])}
              />
            </div>
          </div>
        </section>
      ))}

      {payslips.length === 0 && (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)', color: 'var(--lf-ink-2)' }}>
          No payslip has been issued to you yet.
        </section>
      )}

      {compensation.length > 0 && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>My salary history</h2>
          <WorkspaceTable
            headers={['Effective from', 'Basic', 'Housing', 'Transport', 'Other', 'Reason']}
            rows={compensation.map((row) => [
              date(row.effectiveFrom),
              money(row.basic, row.currency),
              money(row.housing, row.currency),
              money(row.transport, row.currency),
              money(row.otherAllowance, row.currency),
              row.changeReason ?? '—',
            ])}
          />
        </section>
      )}
    </div>
  );
}

const date = (value: Date) => value.toLocaleDateString('en-AE', { timeZone: 'UTC' });
const money = (value: { toString(): string }, currency: string) =>
  `${currency} ${Number(value.toString()).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
