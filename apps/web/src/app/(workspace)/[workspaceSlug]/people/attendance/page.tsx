import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import { isHrAdmin, myEmployee } from '@/services/hr/leave';
import { isAttendanceApprover, mayReadAllEmployees } from '@/services/hr/access';
import { reviewQueue } from '@/services/hr/attendance';

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });
  const hr = isHrAdmin(ctx);
  // Same scope the API route enforces: attendance is a record of where a named
  // person was and when, so without the wider authority you see only your own.
  const seesAll = mayReadAllEmployees(ctx) || isAttendanceApprover(ctx);
  const self = seesAll ? null : await myEmployee(ctx);

  const [employees, records, review] = await Promise.all([
    seesAll
      ? prisma.employeeProfile.findMany({
          where: { tenantId: ctx.tenantId, deletedAt: null },
          include: { membership: { include: { platformUser: true } } },
          orderBy: { employeeNumber: 'asc' },
        })
      : [],
    prisma.hrAttendanceRecord.findMany({
      where: { tenantId: ctx.tenantId, ...(seesAll ? {} : { employeeId: self?.id ?? '' }) },
      include: { employee: { include: { membership: { include: { platformUser: true } } } }, location: true },
      orderBy: { workDate: 'desc' },
      take: 100,
    }),
    hr ? reviewQueue(ctx, 100) : Promise.resolve([]),
  ]);

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
      <section>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>Attendance</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)' }}>
          Employees record their own attendance by face at{' '}
          <Link href={`/${workspaceSlug}/people/check-in`}>check-in</Link>. Manual entry below is for HR corrections.
        </p>
      </section>

      {hr && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Review queue</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
            Simulated locations and repeated face or liveness failures. A rejected attempt is the record of who tried —
            the capture frame is kept encrypted against the punch.
          </p>
          <WorkspaceTable
            headers={['When', 'Employee', 'Type', 'Result', 'Face score', 'Mock GPS', 'Reason']}
            empty="Nothing needs review."
            rows={review.map((row) => [
              row.serverTime.toLocaleString('en-AE', { timeZone: 'UTC' }),
              row.employee.membership.platformUser.fullName,
              row.punchType === 'CHECK_IN' ? 'Check in' : 'Check out',
              <span className="lf-badge" key="r">
                {row.result.replace(/_/g, ' ').toLowerCase()}
              </span>,
              row.faceScore == null ? '—' : row.faceScore.toFixed(3),
              row.mockLocationFlag ? 'Yes' : 'No',
              row.rejectReason ?? '—',
            ])}
          />
        </section>
      )}

      {seesAll && (
      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Record attendance manually</h2>
        <WorkspaceRecordForm
          endpoint={`/api/v1/workspaces/${workspaceSlug}/hr/attendance`}
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
            { name: 'workDate', label: 'Work date', type: 'date', required: true },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              required: true,
              options: ['PRESENT', 'ABSENT', 'LATE', 'REMOTE', 'ON_LEAVE'].map((value) => ({
                value,
                label: value.replace('_', ' '),
              })),
            },
            { name: 'notes', label: 'Notes' },
          ]}
        />
      </section>
      )}

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Daily record</h2>
        <WorkspaceTable
          headers={['Date', 'Employee', 'In', 'Out', 'Worked', 'Location', 'Status']}
          rows={records.map((record) => [
            record.workDate.toLocaleDateString('en-AE', { timeZone: 'UTC' }),
            record.employee.membership.platformUser.fullName,
            record.checkInAt ? time(record.checkInAt) : '—',
            record.checkOutAt ? time(record.checkOutAt) : '—',
            record.workMinutes
              ? `${Math.floor(record.workMinutes / 60)}h ${String(record.workMinutes % 60).padStart(2, '0')}m`
              : '—',
            record.location?.name ?? '—',
            <span className="lf-badge" key="s">
              {record.status}
            </span>,
          ])}
        />
      </section>
    </div>
  );
}

const time = (value: Date) =>
  value.toLocaleTimeString('en-AE', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
