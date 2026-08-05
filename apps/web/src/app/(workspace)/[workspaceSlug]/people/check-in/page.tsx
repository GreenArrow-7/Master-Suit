import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import FaceCapture from '@/components/workspace/FaceCapture';
import { isHrAdmin, myEmployee } from '@/services/hr/leave';
import { attendanceDays, faceStatus, myPunches, openCheckIn } from '@/services/hr/attendance';

export default async function Page({ params, searchParams }: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ enrol?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { enrol } = await searchParams;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, 'HRMS');
  const actions = `/api/v1/workspaces/${workspaceSlug}/hr/actions`;

  const employee = await myEmployee(ctx);
  if (!employee) {
    return <section className="lf-card" style={{ padding: 'var(--lf-space-6)' }}>
      <div className="lf-eyebrow">People</div>
      <h1 style={{ margin: '8px 0 0' }}>Check in</h1>
      <p style={{ color: 'var(--lf-ink-600)' }}>Your account has no employee record in this workspace, so there is nothing to record attendance against. Ask HR to create one.</p>
    </section>;
  }

  const hr = isHrAdmin(ctx);
  const [status, punches, days, open, assignments, employees] = await Promise.all([
    faceStatus(ctx),
    myPunches(ctx, 15),
    attendanceDays(ctx, { limit: 14 }),
    openCheckIn(ctx, employee.id),
    prisma.hrEmployeeLocationAssignment.findMany({
      where: { tenantId: ctx.tenantId, employeeId: employee.id, status: 'ACTIVE' },
      include: { location: true },
    }),
    hr ? prisma.employeeProfile.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
      include: { membership: { include: { platformUser: true } } },
      orderBy: { employeeNumber: 'asc' },
    }) : [],
  ]);

  const enrolTarget = enrol ? employees.find((row) => row.id === enrol) : undefined;

  return <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
    <section>
      <div className="lf-eyebrow">People</div>
      <h1 style={{ margin: '8px 0 0' }}>Check in</h1>
      <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)' }}>
        The camera frame is verified on the server, inside your assigned work location. Face verification is the only way to record attendance — there is no PIN fallback.
      </p>
    </section>

    {!status.engineReady && <section className="lf-alert" role="alert">
      <strong>Face check-in is unavailable.</strong>
      <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 'var(--lf-text-sm)' }}>{status.engineDetail}</div>
      <div style={{ marginTop: 6, fontSize: 'var(--lf-text-sm)' }}>Attendance fails closed on purpose: nothing is recorded while the engine is down.</div>
    </section>}

    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--lf-space-4)' }}>
      {([
        ['Biometric consent', status.consentGrantedAt ? 'Granted' : 'Not given'],
        ['Face enrolment', status.enrolled ? `${status.enrolledSamples} samples` : `${status.enrolledSamples} of ${status.samplesRequired}`],
        ['Assigned locations', assignments.length],
        ['Current state', open ? 'Checked in' : 'Checked out'],
      ] as const).map(([label, value]) => <article className="lf-card" key={label} style={{ padding: 'var(--lf-space-5)' }}>
        <div className="lf-eyebrow">{label}</div>
        <div style={{ fontFamily: 'var(--lf-font-display)', fontSize: 24, marginTop: 6 }}>{value}</div>
      </article>)}
    </section>

    {!status.consentGrantedAt
      ? <section className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 10 }}>
          <div>
            <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>Biometric consent</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
              Face check-in stores a 512-number mathematical template of your face, not a photograph of it, and the capture frame from each punch is kept encrypted as evidence for a limited period.
              You can withdraw consent at any time; withdrawal deletes your templates immediately. Without consent no biometric data is processed at all.
            </p>
          </div>
          <WorkspaceActionButton endpoint={`${actions}/consent-grant`} body={{}} label="I consent to face check-in" />
        </section>
      : <section style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
          {status.enrolled
            ? <>
                <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>Record attendance</h2>
                {assignments.length === 0
                  ? <div className="lf-alert">You have no active work-location assignment, so no check-in can be accepted. Ask HR to assign you a location.</div>
                  : <FaceCapture mode="punch" endpointBase={actions} />}
              </>
            : <div className="lf-alert">Your face is not enrolled yet ({status.enrolledSamples} of {status.samplesRequired} samples). HR does this in person.</div>}
          <div>
            <WorkspaceActionButton
              endpoint={`${actions}/consent-withdraw`}
              body={{}}
              label="Withdraw biometric consent"
              variant="ghost"
              confirm="This deletes your face templates immediately and you will not be able to check in until you enrol again. Continue?"
            />
          </div>
        </section>}

    {hr && <section className="lf-card" style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 12 }}>
      <div>
        <div className="lf-eyebrow">HR only</div>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '6px 0 0' }}>Face enrolment</h2>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
          Done in person, with the employee present. Their biometric consent must be recorded first. Raw images are never stored — only the template.
        </p>
      </div>
      <form method="get" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="lf-field" style={{ minWidth: 260 }}>
          <span className="lf-label">Employee</span>
          <select className="lf-input" name="enrol" defaultValue={enrol ?? ''}>
            <option value="">Select…</option>
            {employees.map((row) => <option key={row.id} value={row.id}>{row.employeeNumber} · {row.membership.platformUser.fullName}</option>)}
          </select>
        </label>
        <button className="lf-btn lf-btn--secondary" type="submit">Load</button>
      </form>
      {enrolTarget && <FaceCapture mode="enrol" endpointBase={actions} employeeId={enrolTarget.id} samplesRequired={status.samplesRequired} />}
    </section>}

    <section>
      <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>My recent attempts</h2>
      <WorkspaceTable
        headers={['When', 'Type', 'Result', 'Location', 'Distance', 'Reason']}
        empty="No check-in has been attempted yet."
        rows={punches.map((row) => [
          row.serverTime.toLocaleString('en-AE', { timeZone: 'UTC' }),
          row.punchType === 'CHECK_IN' ? 'Check in' : 'Check out',
          <span className="lf-badge" key="r">{row.result.replace(/_/g, ' ').toLowerCase()}</span>,
          row.location?.name ?? '—',
          row.distanceM == null ? '—' : `${Math.round(row.distanceM)} m`,
          row.rejectReason ?? '—',
        ])}
      />
    </section>

    <section>
      <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>My attendance</h2>
      <WorkspaceTable
        headers={['Day', 'In', 'Out', 'Worked', 'Location', 'Status']}
        empty="No attendance has been recorded yet."
        rows={days.map((day) => [
          day.workDate.toLocaleDateString('en-AE', { timeZone: 'UTC' }),
          day.checkInAt ? time(day.checkInAt) : '—',
          day.checkOutAt ? time(day.checkOutAt) : '—',
          day.workMinutes ? `${Math.floor(day.workMinutes / 60)}h ${String(day.workMinutes % 60).padStart(2, '0')}m` : '—',
          day.location?.name ?? '—',
          <span className="lf-badge" key="s">{day.checkOutAt ? 'complete' : 'open'}</span>,
        ])}
      />
    </section>
  </div>;
}

const time = (value: Date) => value.toLocaleTimeString('en-AE', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
