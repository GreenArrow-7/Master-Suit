import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import { myEmployee } from '@/services/hr/leave';
import { isPayrollApprover, isPayrollOfficer, listRuns, runDetail } from '@/services/hr/payroll';
import { getHrPolicy } from '@/services/hr/settings';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { run: selectedId } = await searchParams;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['payroll', 'VIEW'] });
  const actions = `/api/v1/workspaces/${workspaceSlug}/hr/actions`;

  const self = await myEmployee(ctx);
  const officer = isPayrollOfficer(ctx);
  const approver = isPayrollApprover(ctx);
  const policy = await getHrPolicy(ctx);

  const [runs, employees, selected] = await Promise.all([
    listRuns(ctx),
    officer
      ? prisma.employeeProfile.findMany({
          where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
          include: { membership: { include: { platformUser: true } } },
          orderBy: { employeeNumber: 'asc' },
        })
      : [],
    selectedId ? runDetail(ctx, selectedId).catch(() => null) : null,
  ]);

  const wpsReady = policy.wpsEmployerId.trim() !== '' && policy.wpsEmployerBankAgentId.trim() !== '';

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
      <section>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>Payroll</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', maxWidth: '78ch' }}>
          A run is calculated from approved HR state only — effective-dated pay, approved overtime, approved unpaid
          leave and entered adjustments. Whoever prepares a run cannot approve it. Locking freezes the overtime claims
          the run paid, so a payslip keeps reconciling against the hours behind it.
        </p>
      </section>

      {officer && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Open a run</h2>
          <WorkspaceRecordForm
            endpoint={`${actions}/payroll-run-create`}
            submitLabel="Open run"
            fields={[
              { name: 'periodStart', label: 'Period start', type: 'date', required: true },
              { name: 'periodEnd', label: 'Period end', type: 'date', required: true },
              { name: 'note', label: 'Note' },
            ]}
          />
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Runs</h2>
        <WorkspaceTable
          headers={['Period', 'Status', 'Payslips', 'Gross', 'Net', 'Prepared by', 'Approved by', 'Actions']}
          empty="No payroll run has been opened yet."
          rows={runs.map((row) => [
            <Link key="period" href={`?run=${row.id}`} className="lf-link">
              {date(row.periodStart)} – {date(row.periodEnd)}
            </Link>,
            <span className="lf-badge" key="status">
              {row.status.replace('_', ' ')}
            </span>,
            row._count?.payslips ?? '—',
            money(row.grossTotal, row.currency),
            money(row.netTotal, row.currency),
            row.preparedBy?.membership.platformUser.fullName ?? '—',
            row.approvedBy?.membership.platformUser.fullName ?? '—',
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} key="actions">
              {officer && row.status === 'DRAFT' && (
                <>
                  <WorkspaceActionButton
                    endpoint={`${actions}/payroll-run-calculate`}
                    body={{ runId: row.id }}
                    label="Calculate"
                  />
                  {row.calculatedAt && (
                    <WorkspaceActionButton
                      endpoint={`${actions}/payroll-run-submit`}
                      body={{ runId: row.id }}
                      label="Submit for approval"
                      variant="ghost"
                    />
                  )}
                </>
              )}
              {approver && row.status === 'PENDING_APPROVAL' && (
                <>
                  {/* Hidden rather than offered-and-refused: the service still
                      enforces it, this only avoids a button that always fails. */}
                  {self?.id === row.preparedById ? (
                    <span style={{ color: 'var(--lf-ink-500)' }}>You prepared this</span>
                  ) : (
                    <>
                      <WorkspaceActionButton
                        endpoint={`${actions}/payroll-run-decide`}
                        body={{ runId: row.id, approve: true }}
                        label="Approve"
                        confirm={`Approve ${money(row.netTotal, row.currency)} of net pay?`}
                      />
                      <WorkspaceActionButton
                        endpoint={`${actions}/payroll-run-decide`}
                        body={{ runId: row.id, approve: false }}
                        label="Send back"
                        variant="danger"
                        promptFor={{ name: 'note', label: 'What needs correcting?' }}
                      />
                    </>
                  )}
                </>
              )}
              {approver && row.status === 'APPROVED' && (
                <WorkspaceActionButton
                  endpoint={`${actions}/payroll-run-lock`}
                  body={{ runId: row.id }}
                  label="Lock"
                  confirm="Locking freezes the overtime claims this run paid. Continue?"
                />
              )}
              {approver && row.status === 'LOCKED' && (
                <WorkspaceActionButton
                  endpoint={`${actions}/payroll-run-paid`}
                  body={{ runId: row.id }}
                  label="Mark paid"
                  variant="ghost"
                />
              )}
              {['APPROVED', 'LOCKED', 'PAID'].includes(row.status) && (
                <a
                  className="lf-btn lf-btn--ghost"
                  href={`/api/v1/workspaces/${workspaceSlug}/hr/payroll/${row.id}/wps`}
                  title={wpsReady ? 'Download the WPS salary file' : 'Set the WPS identifiers in HR policy first'}
                >
                  WPS file
                </a>
              )}
            </span>,
          ])}
        />
        {!wpsReady && (
          <p style={{ margin: '10px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
            WPS export needs the employer MOL identifier and bank agent identifier, set under{' '}
            <Link className="lf-link" href={`/${workspaceSlug}/people/settings`}>
              HR policy
            </Link>
            . Until they are set the export refuses rather than producing a file the bank would reject.
          </p>
        )}
      </section>

      {selected && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>
            {date(selected.periodStart)} – {date(selected.periodEnd)} · {selected.payslips.length} payslips
          </h2>
          <WorkspaceTable
            headers={['Employee', 'Basic', 'Overtime', 'Unpaid days', 'Gross', 'Deductions', 'Net']}
            empty="This run has not been calculated yet."
            rows={selected.payslips.map((payslip) => [
              payslip.employee.membership.platformUser.fullName,
              money(payslip.basic, payslip.currency),
              payslip.overtimeMinutes ? `${(payslip.overtimeMinutes / 60).toFixed(2)} h` : '—',
              payslip.unpaidDays || '—',
              money(payslip.grossEarnings, payslip.currency),
              money(payslip.totalDeductions, payslip.currency),
              <strong key="net">{money(payslip.netPay, payslip.currency)}</strong>,
            ])}
          />
        </section>
      )}

      {officer && (
        <>
          <section>
            <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Record compensation</h2>
            <p style={{ margin: '0 0 10px', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
              A raise is a new record, never an edit. Past runs keep the salary that was in force when they were
              calculated.
            </p>
            <WorkspaceRecordForm
              endpoint={`${actions}/compensation-set`}
              submitLabel="Record salary"
              fields={[
                {
                  name: 'employeeId',
                  label: 'Employee',
                  type: 'select',
                  required: true,
                  options: employees.map((employee) => ({
                    value: employee.id,
                    label: employee.membership.platformUser.fullName,
                  })),
                },
                { name: 'effectiveFrom', label: 'Effective from', type: 'date', required: true },
                { name: 'basic', label: 'Basic', type: 'number', required: true },
                { name: 'housing', label: 'Housing allowance', type: 'number' },
                { name: 'transport', label: 'Transport allowance', type: 'number' },
                { name: 'otherAllowance', label: 'Other allowances', type: 'number' },
                { name: 'changeReason', label: 'Reason for the change' },
              ]}
            />
          </section>

          <section>
            <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>One-off adjustment</h2>
            <p style={{ margin: '0 0 10px', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
              A bonus, commission, reimbursement or deduction. Picked up by whichever draft run covers its date, and
              stamped as consumed when that run locks so it cannot be paid twice.
            </p>
            <WorkspaceRecordForm
              endpoint={`${actions}/payroll-adjustment-add`}
              submitLabel="Add adjustment"
              fields={[
                {
                  name: 'employeeId',
                  label: 'Employee',
                  type: 'select',
                  required: true,
                  options: employees.map((employee) => ({
                    value: employee.id,
                    label: employee.membership.platformUser.fullName,
                  })),
                },
                { name: 'effectiveOn', label: 'Effective on', type: 'date', required: true },
                {
                  name: 'kind',
                  label: 'Type',
                  type: 'select',
                  required: true,
                  options: [
                    { value: 'EARNING', label: 'Addition' },
                    { value: 'DEDUCTION', label: 'Deduction' },
                  ],
                },
                { name: 'code', label: 'Code (e.g. BONUS)', required: true },
                { name: 'label', label: 'Description', required: true },
                { name: 'amount', label: 'Amount', type: 'number', required: true },
                { name: 'reason', label: 'Reason' },
              ]}
            />
          </section>
        </>
      )}
    </div>
  );
}

const date = (value: Date) => value.toLocaleDateString('en-AE', { timeZone: 'UTC' });
const money = (value: { toString(): string }, currency: string) =>
  `${currency} ${Number(value.toString()).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
