import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import { balancesFor, isApprover, isHrAdmin, myEmployee } from '@/services/hr/leave';

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, 'HRMS');
  const actions = `/api/v1/workspaces/${workspaceSlug}/hr/actions`;

  const self = await myEmployee(ctx);
  const hr = isHrAdmin(ctx);
  const approver = isApprover(ctx);

  // Same scoping as the API: your own leave, plus what you approve, plus
  // everything only when you are HR.
  const scope = hr ? {} : approver ? { OR: [{ employeeId: self?.id ?? '' }, { approverId: self?.id ?? '' }] } : { employeeId: self?.id ?? '' };

  const [employees, types, requests, pending, balances] = await Promise.all([
    prisma.employeeProfile.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
      include: { membership: { include: { platformUser: true } } },
      orderBy: { employeeNumber: 'asc' },
    }),
    prisma.hrLeaveType.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.hrLeaveRequest.findMany({
      where: { tenantId: ctx.tenantId, ...scope },
      include: { employee: { include: { membership: { include: { platformUser: true } } } }, leaveType: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    approver
      ? prisma.hrLeaveRequest.findMany({
          where: { tenantId: ctx.tenantId, status: 'PENDING', ...(hr ? {} : { approverId: self?.id ?? '' }) },
          include: { employee: { include: { membership: { include: { platformUser: true } } } }, leaveType: true },
          orderBy: { startDate: 'asc' },
        })
      : [],
    self ? balancesFor(ctx, self.id) : [],
  ]);

  return <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
    <section>
      <div className="lf-eyebrow">People</div>
      <h1 style={{ margin: '8px 0 0' }}>Leave</h1>
      <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)' }}>
        Weekends and public holidays never consume balance. Paid leave cannot exceed what has accrued.
      </p>
    </section>

    {balances.length > 0 && <section>
      <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>My balances</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--lf-space-4)' }}>
        {balances.map((balance) => <article className="lf-card" key={balance.leaveTypeId} style={{ padding: 'var(--lf-space-5)' }}>
          <div className="lf-eyebrow">{balance.name}{balance.paid ? '' : ' · unpaid'}</div>
          <div style={{ fontFamily: 'var(--lf-font-display)', fontSize: 32, marginTop: 6 }}>{balance.availableDays}</div>
          <div style={{ color: 'var(--lf-ink-500)', fontSize: 'var(--lf-text-xs)' }}>
            days available · {balance.accruedDays} accrued{balance.carriedForwardDays ? ` · ${balance.carriedForwardDays} carried` : ''} · {balance.takenDays} used
          </div>
        </article>)}
      </div>
    </section>}

    {pending.length > 0 && <section>
      <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Awaiting your decision</h2>
      <WorkspaceTable
        headers={['Employee', 'Type', 'Dates', 'Days', 'Reason', 'Decision']}
        rows={pending.map((request) => [
          request.employee.membership.platformUser.fullName,
          request.leaveType.name,
          `${date(request.startDate)} – ${date(request.endDate)}`,
          request.days,
          request.reason ?? '—',
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} key="decide">
            <WorkspaceActionButton endpoint={`${actions}/leave-approve`} body={{ requestId: request.id }} label="Approve" />
            <WorkspaceActionButton endpoint={`${actions}/leave-reject`} body={{ requestId: request.id }} label="Reject" variant="danger" promptFor={{ name: 'note', label: 'Reason for rejection' }} />
          </span>,
        ])}
      />
    </section>}

    <section>
      <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Apply for leave</h2>
      <WorkspaceRecordForm
        endpoint={`/api/v1/workspaces/${workspaceSlug}/hr/leave`}
        submitLabel="Submit leave request"
        fields={[
          ...(hr ? [{ name: 'employeeId', label: 'Employee (HR only — leave blank for yourself)', type: 'select' as const, options: employees.map((employee) => ({ value: employee.id, label: employee.membership.platformUser.fullName })) }] : []),
          { name: 'leaveTypeId', label: 'Leave type', type: 'select', required: true, options: types.map((type) => ({ value: type.id, label: `${type.name}${type.paid ? '' : ' (unpaid)'}` })) },
          { name: 'startDate', label: 'Start date', type: 'date', required: true },
          { name: 'endDate', label: 'End date', type: 'date', required: true },
          { name: 'reason', label: 'Reason' },
        ]}
      />
    </section>

    <section>
      <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Requests</h2>
      <WorkspaceTable
        headers={['Employee', 'Type', 'Dates', 'Days', 'Status', '']}
        empty="No leave has been requested yet."
        rows={requests.map((request) => [
          request.employee.membership.platformUser.fullName,
          request.leaveType.name,
          `${date(request.startDate)} – ${date(request.endDate)}`,
          request.days,
          <span className="lf-badge" key="status">{request.status}</span>,
          (request.status === 'PENDING' || request.status === 'APPROVED') && (hr || request.employeeId === self?.id)
            ? <WorkspaceActionButton key="cancel" endpoint={`${actions}/leave-cancel`} body={{ requestId: request.id }} label="Cancel" variant="ghost" confirm="Cancel this leave request?" />
            : '—',
        ])}
      />
    </section>

    {hr && <section className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 10 }}>
      <div>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>Year-end carry-forward</h2>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
          Rolls unused accruing leave into the next year, up to each type&apos;s cap. Run once, after the year closes.
        </p>
      </div>
      <WorkspaceActionButton
        endpoint={`${actions}/leave-carry-forward`}
        body={{}}
        label={`Run carry-forward from ${new Date().getUTCFullYear() - 1}`}
        promptFor={{ name: 'fromYear', label: `Year to roll forward (e.g. ${new Date().getUTCFullYear() - 1})` }}
      />
    </section>}
  </div>;
}

const date = (value: Date) => value.toLocaleDateString('en-AE', { timeZone: 'UTC' });
