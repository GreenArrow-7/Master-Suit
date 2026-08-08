import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import { myEmployee } from '@/services/hr/leave';
import { isHrAdmin, isOvertimeApprover } from '@/services/hr/access';
import { getHrPolicy } from '@/services/hr/settings';

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });
  const actions = `/api/v1/workspaces/${workspaceSlug}/hr/actions`;

  const self = await myEmployee(ctx);
  const approver = isOvertimeApprover(ctx);
  const hr = isHrAdmin(ctx);
  const policy = await getHrPolicy(ctx);

  // Same scoping as `listOvertime`: an approver sees the workspace, everyone
  // else sees their own claims and nothing else.
  const scope = approver ? {} : { employeeId: self?.id ?? '' };

  const [claims, pending, employees] = await Promise.all([
    prisma.hrOvertimeRequest.findMany({
      where: { tenantId: ctx.tenantId, ...scope },
      include: { employee: { include: { membership: { include: { platformUser: true } } } } },
      orderBy: [{ workDate: 'desc' }, { id: 'desc' }],
      take: 100,
    }),
    approver
      ? prisma.hrOvertimeRequest.findMany({
          where: { tenantId: ctx.tenantId, status: 'PENDING' },
          include: { employee: { include: { membership: { include: { platformUser: true } } } } },
          orderBy: { workDate: 'asc' },
          take: 100,
        })
      : [],
    approver
      ? prisma.employeeProfile.findMany({
          where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
          include: { membership: { include: { platformUser: true } } },
          orderBy: { employeeNumber: 'asc' },
        })
      : [],
  ]);

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
      <section>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>Overtime</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)' }}>
          Detection reads the attendance roll-up and raises a claim; it never pays anything on its own. Every claim
          needs a decision, and nobody decides their own.
        </p>
      </section>

      {pending.length > 0 && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Awaiting your decision</h2>
          <WorkspaceTable
            headers={['Employee', 'Date', 'Hours', 'Rate', 'Source', 'Reason', 'Decision']}
            rows={pending.map((claim) => [
              claim.employee.membership.platformUser.fullName,
              date(claim.workDate),
              <span key="hours" title={`${claim.minutes} minutes`}>
                {hours(claim.minutes)}
                {claim.minutes > policy.overtimeDailyCapMinutes && (
                  <span className="lf-badge" style={{ marginLeft: 6 }} title="Above the statutory daily ceiling">
                    over cap
                  </span>
                )}
              </span>,
              <span className="lf-badge" key="kind">
                {claim.kind}
              </span>,
              claim.source === 'DETECTED' ? 'Detected' : 'Claimed',
              claim.reason ?? '—',
              // Self-approval is refused by the service too; hiding the buttons
              // just avoids offering an action that would only fail.
              claim.employeeId === self?.id ? (
                <span key="own" style={{ color: 'var(--lf-ink-500)' }}>
                  Your own claim
                </span>
              ) : (
                <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} key="decide">
                  <WorkspaceActionButton
                    endpoint={`${actions}/overtime-decide`}
                    body={{ requestId: claim.id, approve: true }}
                    label="Approve"
                  />
                  {policy.overtimeCompensatoryAllowed && (
                    <WorkspaceActionButton
                      endpoint={`${actions}/overtime-decide`}
                      body={{ requestId: claim.id, approve: true, compensatory: true }}
                      label="Approve as time off"
                      variant="ghost"
                    />
                  )}
                  <WorkspaceActionButton
                    endpoint={`${actions}/overtime-decide`}
                    body={{ requestId: claim.id, approve: false }}
                    label="Reject"
                    variant="danger"
                    promptFor={{ name: 'note', label: 'Reason for rejection' }}
                  />
                </span>
              ),
            ])}
          />
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Claim overtime</h2>
        <WorkspaceRecordForm
          endpoint={`${actions}/overtime-request`}
          submitLabel="Submit claim"
          fields={[
            ...(approver
              ? [
                  {
                    name: 'employeeId',
                    label: 'Employee (leave blank for yourself)',
                    type: 'select' as const,
                    options: employees.map((employee) => ({
                      value: employee.id,
                      label: employee.membership.platformUser.fullName,
                    })),
                  },
                ]
              : []),
            { name: 'workDate', label: 'Date worked', type: 'date', required: true },
            { name: 'minutes', label: 'Minutes of overtime', type: 'number', required: true },
            { name: 'reason', label: 'Reason', required: true },
          ]}
        />
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Claims</h2>
        <WorkspaceTable
          headers={['Employee', 'Date', 'Hours', 'Rate', 'Source', 'Status', 'Settled as', '']}
          empty="No overtime has been claimed or detected yet."
          rows={claims.map((claim) => [
            claim.employee.membership.platformUser.fullName,
            date(claim.workDate),
            hours(claim.minutes),
            <span className="lf-badge" key="kind">
              {claim.kind}
              {claim.multiplier ? ` ×${claim.multiplier}` : ''}
            </span>,
            claim.source === 'DETECTED' ? 'Detected' : 'Claimed',
            <span className="lf-badge" key="status">
              {claim.status}
            </span>,
            claim.status !== 'APPROVED' ? '—' : claim.compensatory ? 'Time off in lieu' : 'Pay',
            claim.status === 'PENDING' && !claim.lockedAt && (hr || claim.employeeId === self?.id) ? (
              <WorkspaceActionButton
                key="cancel"
                endpoint={`${actions}/overtime-cancel`}
                body={{ requestId: claim.id }}
                label="Withdraw"
                variant="ghost"
                confirm="Withdraw this overtime claim?"
              />
            ) : (
              '—'
            ),
          ])}
        />
      </section>

      {approver && (
        <section className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>Detect from attendance</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
              Scans closed attendance days for time worked beyond the rostered shift and raises a claim for anything
              over {policy.overtimeMinMinutes} minutes. Safe to re-run: a day already scanned is updated, not
              duplicated, and claims already decided are left alone.
              {!policy.overtimeDetectionEnabled && ' Detection is currently switched off in HR settings.'}
            </p>
          </div>
          <WorkspaceActionButton
            endpoint={`${actions}/overtime-detect`}
            body={{ from: isoDay(daysAgo(30)), to: isoDay(new Date()) }}
            label="Scan the last 30 days"
          />
        </section>
      )}
    </div>
  );
}

const date = (value: Date) => value.toLocaleDateString('en-AE', { timeZone: 'UTC' });
const isoDay = (value: Date) => value.toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
/** 90 → "1h 30m". Minutes are what the model stores; hours are what people read. */
const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
