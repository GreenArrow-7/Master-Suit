import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import { isHrAdmin } from '@/services/hr/leave';
import { checklistFor, expiringDocuments, lifecycleDashboard, settlementFor } from '@/services/hr/lifecycle';

export default async function Page({ params, searchParams }: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ employeeId?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { employeeId } = await searchParams;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, 'HRMS');
  const actions = `/api/v1/workspaces/${workspaceSlug}/hr/actions`;

  if (!isHrAdmin(ctx)) {
    return <section className="lf-card" style={{ padding: 'var(--lf-space-6)' }}>
      <div className="lf-eyebrow">People</div>
      <h1 style={{ margin: '8px 0 0' }}>Employee lifecycle</h1>
      <p style={{ color: 'var(--lf-ink-600)' }}>Onboarding, offboarding and final settlement are restricted to HR and administrators.</p>
    </section>;
  }

  const [dashboard, employees, expiring] = await Promise.all([
    lifecycleDashboard(ctx),
    prisma.employeeProfile.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      include: { membership: { include: { platformUser: true } } },
      orderBy: { employeeNumber: 'asc' },
    }),
    expiringDocuments(ctx, 90),
  ]);

  const selected = employeeId ? employees.find((employee) => employee.id === employeeId) : undefined;
  const [checklist, settlement] = await Promise.all([
    selected ? checklistFor(ctx, selected.id) : Promise.resolve([]),
    selected && selected.joinedOn && (selected.employmentStatus === 'NOTICE' || selected.employmentStatus === 'EXITED')
      ? settlementFor(ctx, selected.id).catch(() => null)
      : Promise.resolve(null),
  ]);

  const employeeOptions = employees.map((employee) => ({ value: employee.id, label: `${employee.employeeNumber} · ${employee.membership.platformUser.fullName}` }));

  return <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
    <section>
      <div className="lf-eyebrow">People</div>
      <h1 style={{ margin: '8px 0 0' }}>Employee lifecycle</h1>
      <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)' }}>
        Blocking checklist steps gate activation and exit. An unstamped visa means someone cannot legally work; open clearance means nobody walks out with a laptop and a live visa.
      </p>
    </section>

    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 'var(--lf-space-4)' }}>
      {([
        ['Joining', dashboard.joining.length],
        ['On notice', dashboard.leaving.length],
        ['Overdue tasks', dashboard.overdueTasks],
        ['Documents expiring (60d)', dashboard.documentsExpiring60d],
        ['Documents expired', dashboard.documentsExpired],
      ] as const).map(([label, value]) => <article className="lf-card" key={label} style={{ padding: 'var(--lf-space-5)' }}>
        <div className="lf-eyebrow">{label}</div>
        <div style={{ fontFamily: 'var(--lf-font-display)', fontSize: 34, marginTop: 6 }}>{value}</div>
      </article>)}
    </section>

    <section>
      <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Joining</h2>
      <WorkspaceTable
        headers={['Employee', 'Number', 'Joins', 'Open blockers', 'Actions']}
        empty="Nobody is currently onboarding."
        rows={dashboard.joining.map((row) => [
          row.name,
          row.employeeNumber,
          row.joinedOn ? date(row.joinedOn) : '—',
          row.openBlockers === 0 ? <span className="lf-badge" key="b">clear</span> : <strong key="b">{row.openBlockers}</strong>,
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} key="a">
            <Link className="lf-btn lf-btn--ghost" href={`?employeeId=${row.employeeId}`}>Checklist</Link>
            <WorkspaceActionButton endpoint={`${actions}/employee-activate`} body={{ employeeId: row.employeeId }} label="Activate" />
          </span>,
        ])}
      />
    </section>

    <section>
      <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>On notice</h2>
      <WorkspaceTable
        headers={['Employee', 'Number', 'Last working day', 'Open clearances', 'Actions']}
        empty="Nobody is serving notice."
        rows={dashboard.leaving.map((row) => [
          row.name,
          row.employeeNumber,
          row.exitedOn ? date(row.exitedOn) : '—',
          row.openBlockers === 0 ? <span className="lf-badge" key="b">clear</span> : <strong key="b">{row.openBlockers}</strong>,
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} key="a">
            <Link className="lf-btn lf-btn--ghost" href={`?employeeId=${row.employeeId}`}>Checklist &amp; settlement</Link>
            <WorkspaceActionButton
              endpoint={`${actions}/employee-exit`}
              body={{ employeeId: row.employeeId, confirmSettlementPaid: true }}
              label="Finalise exit"
              variant="danger"
              confirm="This closes the account, revokes every session and withdraws biometric consent. Confirm the final settlement has been paid."
            />
          </span>,
        ])}
      />
    </section>

    {selected && <section className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 'var(--lf-space-4)' }}>
      <div>
        <div className="lf-eyebrow">{selected.employeeNumber} · {selected.employmentStatus}</div>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '6px 0 0' }}>{selected.membership.platformUser.fullName}</h2>
      </div>

      <WorkspaceTable
        headers={['Phase', 'Task', 'Owner', 'Due', 'State', '']}
        empty="No checklist has been created for this employee yet."
        rows={checklist.map((task) => [
          task.phase,
          task.blocking ? <strong key="t">{task.title}</strong> : task.title,
          task.ownerDepartment ?? '—',
          task.dueDate ? date(task.dueDate) : '—',
          task.completed
            ? <span className="lf-badge" key="s">done</span>
            : <span className="lf-badge" key="s">{task.overdue ? 'overdue' : 'open'}{task.blocking ? ' · blocking' : ''}</span>,
          task.completed
            ? <WorkspaceActionButton key="x" endpoint={`${actions}/checklist-reopen`} body={{ taskId: task.id }} label="Reopen" variant="ghost" />
            : <WorkspaceActionButton key="x" endpoint={`${actions}/checklist-complete`} body={{ taskId: task.id }} label="Complete" />,
        ])}
      />

      {settlement && <div>
        <h3 style={{ fontSize: 'var(--lf-text-md)', margin: '0 0 8px' }}>Indicative final settlement</h3>
        <WorkspaceTable
          headers={['Line', 'Basis', 'Amount (AED)']}
          rows={[
            [`Gratuity — ${settlement.gratuityDays} days over ${settlement.serviceYears} years${settlement.gratuityCapped ? ' (capped at two years’ basic)' : ''}`, 'Basic salary', money(settlement.gratuityAmount)],
            [`Leave encashment — ${settlement.unusedLeaveDays} unused days`, 'Basic salary', money(settlement.leaveEncashmentAmount)],
            [`Notice shortfall — ${settlement.noticeShortfallDays} days`, settlement.noticePayBasis === 'total' ? 'Total remuneration' : 'Basic salary', `− ${money(settlement.noticeDeductionAmount)}`],
            [<strong key="t">Total payable</strong>, '', <strong key="v">{money(settlement.totalPayable)}</strong>],
          ]}
        />
        <p style={{ margin: '8px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-xs)' }}>
          {settlement.note}{settlement.clearanceComplete ? '' : ` Outstanding clearance: ${settlement.outstandingClearances.join(', ')}.`}
        </p>
      </div>}

      <div>
        <Link className="lf-btn lf-btn--ghost" href="?">Close</Link>
      </div>
    </section>}

    <section style={{ display: 'grid', gap: 'var(--lf-space-5)' }}>
      <div>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Start onboarding</h2>
        <WorkspaceRecordForm
          endpoint={`${actions}/onboarding-start`}
          submitLabel="Create onboarding checklist"
          fields={[{ name: 'employeeId', label: 'Employee', type: 'select', required: true, options: employeeOptions }]}
        />
      </div>

      <div>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Start offboarding</h2>
        <WorkspaceRecordForm
          endpoint={`${actions}/offboarding-start`}
          submitLabel="Start offboarding"
          fields={[
            { name: 'employeeId', label: 'Employee', type: 'select', required: true, options: employeeOptions },
            { name: 'noticeGivenOn', label: 'Notice given on', type: 'date', required: true },
            { name: 'noticePeriodDays', label: 'Notice period (days)', type: 'number', placeholder: '30' },
            { name: 'lastWorkingOn', label: 'Last working day (defaults to notice + period)', type: 'date' },
            { name: 'separationType', label: 'Separation', type: 'select', options: [{ value: 'RESIGNATION', label: 'Resignation' }, { value: 'TERMINATION', label: 'Termination by employer' }] },
            { name: 'reason', label: 'Reason', required: true },
          ]}
        />
      </div>
    </section>

    <section>
      <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Expiring documents</h2>
      <WorkspaceTable
        headers={['Employee', 'Document', 'Number', 'Expires', 'Days left', 'Severity']}
        empty="No documents expire in the next 90 days."
        rows={expiring.map((document) => [
          document.employeeName,
          document.kind,
          document.number ?? '—',
          date(document.expiresAt),
          document.daysRemaining,
          <span className="lf-badge" key="s">{document.severity}</span>,
        ])}
      />
    </section>
  </div>;
}

const date = (value: Date) => value.toLocaleDateString('en-AE', { timeZone: 'UTC' });
const money = (value: number) => value.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
