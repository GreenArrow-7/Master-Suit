import { prisma } from '@/lib/db';
import { forbidden } from 'next/navigation';
import { queryDate } from '@/services/hr/rules';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import { isHrAdmin } from '@/services/hr/access';
import ExportCsv from '@/components/workspace/ExportCsv';
import { csvCell } from '@/lib/csv';
import SalesLink from '@/components/workspace/SalesLink';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';

export const metadata = { title: 'Face recognition activity' };

const DUBAI = 'Asia/Dubai';
const stamp = (value: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: DUBAI,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value);

/** What each punch result means in plain words, for the activity log. */
const OUTCOME: Record<string, { label: string; ok: boolean; reason?: string }> = {
  ACCEPTED: { label: 'Success', ok: true },
  FLAGGED_REVIEW: { label: 'Flagged for review', ok: false, reason: 'Device reported a simulated location' },
  REJECTED_FACE: { label: 'Failed', ok: false, reason: 'Face did not match the enrolled templates' },
  REJECTED_LIVENESS: { label: 'Failed', ok: false, reason: 'Liveness check failed' },
  REJECTED_GEOFENCE: { label: 'Failed', ok: false, reason: 'Outside the approved geofence' },
  REJECTED_ACCURACY: { label: 'Failed', ok: false, reason: 'GPS accuracy below the required threshold' },
  REJECTED_DUPLICATE: { label: 'Failed', ok: false, reason: 'Out-of-sequence or duplicate punch' },
  REJECTED_STALE_SYNC: { label: 'Failed', ok: false, reason: 'Queued punch too old to sync' },
};

/**
 * Face recognition activity — the biometric audit trail.
 *
 * Every enrolment, consent change and verification attempt, accepted or
 * refused, with the geofence evidence the server measured. Administrators can
 * read the metadata; the templates themselves are never selected here, never
 * returned by the API and never exported, because a face template is the one
 * artefact that cannot be re-issued if it leaks.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ employee?: string; event?: string; status?: string; from?: string; to?: string }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });
  // The same interrupt the page gate uses: a role that does not cover this
  // screen deserves the refusal page, not "something went wrong on our side".
  if (!isHrAdmin(ctx)) forbidden();

  const to = queryDate(query.to, new Date());
  const from = queryDate(query.from, new Date(to.getTime() - 29 * 86_400_000));
  const toEnd = new Date(to);
  toEnd.setHours(23, 59, 59, 999);

  const [punches, employees, consents] = await Promise.all([
    prisma.hrAttendancePunch.findMany({
      where: {
        tenantId: ctx.tenantId,
        serverTime: { gte: from, lte: toEnd },
        ...(query.employee ? { employeeId: query.employee } : {}),
        ...(query.event === 'checkin' ? { punchType: 'CHECK_IN' } : {}),
        ...(query.event === 'checkout' ? { punchType: 'CHECK_OUT' } : {}),
        ...(query.status === 'success' ? { result: 'ACCEPTED' } : {}),
        ...(query.status === 'failure' ? { result: { not: 'ACCEPTED' } } : {}),
      },
      // Note the omit: the location snapshot coordinates and the capture path
      // are evidence, not screen data.
      omit: { locLatitude: true, locLongitude: true, capturePath: true },
      include: {
        employee: {
          select: { employeeNumber: true, membership: { select: { platformUser: { select: { fullName: true } } } } },
        },
        location: { select: { name: true } },
      },
      orderBy: { serverTime: 'desc' },
      take: 200,
    }),
    prisma.employeeProfile.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      select: {
        id: true,
        employeeNumber: true,
        membership: { select: { platformUser: { select: { fullName: true } } } },
      },
      orderBy: { employeeNumber: 'asc' },
    }),
    prisma.biometricConsent.findMany({
      where: { tenantId: ctx.tenantId },
      select: { employeeId: true, grantedAt: true, withdrawnAt: true, policyVersion: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);

  const rows = punches.map((punch) => {
    const outcome = OUTCOME[punch.result] ?? { label: punch.result, ok: false };
    return {
      id: punch.id,
      employee: punch.employee.membership.platformUser.fullName,
      employeeNumber: punch.employee.employeeNumber,
      at: stamp(punch.serverTime),
      event: punch.punchType === 'CHECK_IN' ? 'Check-in' : 'Check-out',
      liveness: punch.livenessScore == null ? '—' : punch.livenessScore.toFixed(2),
      match: punch.faceScore == null ? '—' : punch.faceScore.toFixed(3),
      location: punch.location?.name ?? '—',
      distance: punch.distanceM == null ? '—' : `${Math.round(punch.distanceM)} m`,
      accuracy: punch.gpsAccuracyM == null ? '—' : `±${Math.round(punch.gpsAccuracyM)} m`,
      inside: punch.result === 'REJECTED_GEOFENCE' ? 'Outside' : punch.distanceM == null ? '—' : 'Inside',
      status: outcome.label,
      ok: outcome.ok,
      reason: punch.rejectReason ?? outcome.reason ?? '—',
      device: punch.deviceFingerprint ? `${punch.deviceFingerprint.slice(0, 8)}…` : '—',
      audit: punch.requestId ?? punch.id,
    };
  });

  const csv = [
    [
      'Employee',
      'Employee code',
      'When',
      'Event',
      'Liveness',
      'Match',
      'Location',
      'Distance',
      'GPS accuracy',
      'Geofence',
      'Status',
      'Reason',
      'Device',
      'Audit reference',
    ]
      .map(csvCell)
      .join(','),
    ...rows.map((row) =>
      [
        row.employee,
        row.employeeNumber,
        row.at,
        row.event,
        row.liveness,
        row.match,
        row.location,
        row.distance,
        row.accuracy,
        row.inside,
        row.status,
        row.reason,
        row.device,
        row.audit,
      ]
        .map(csvCell)
        .join(','),
    ),
  ].join('\r\n');

  const iso = (value: Date) => value.toISOString().slice(0, 10);

  return (
    <div className="lf-page-stack">
      <section>
        <div className="lf-eyebrow">Administration</div>
        <h1 style={{ margin: '8px 0 0' }}>Face recognition activity</h1>
        <details className="lf-help">
          <summary>How this works</summary>
          <div className="lf-help__body">
            Every enrolment, consent change and verification attempt, accepted or refused, with the geofence evidence
            the server measured. Templates are never shown, returned or exported — a face template cannot be re-issued
            if it leaks.
          </div>
        </details>
      </section>

      <form className="lf-card lf-users__filters" method="get">
        <div className="lf-field" style={{ margin: 0, minWidth: 220 }}>
          <label className="lf-label" htmlFor="fa-emp">
            Employee
          </label>
          <select id="fa-emp" className="lf-input" name="employee" defaultValue={query.employee ?? ''}>
            <option value="">All employees</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.membership.platformUser.fullName} · {employee.employeeNumber}
              </option>
            ))}
          </select>
        </div>
        <div className="lf-field" style={{ margin: 0 }}>
          <label className="lf-label" htmlFor="fa-event">
            Event type
          </label>
          <select id="fa-event" className="lf-input" name="event" defaultValue={query.event ?? ''}>
            <option value="">All events</option>
            <option value="checkin">Check-in</option>
            <option value="checkout">Check-out</option>
          </select>
        </div>
        <div className="lf-field" style={{ margin: 0 }}>
          <label className="lf-label" htmlFor="fa-status">
            Status
          </label>
          <select id="fa-status" className="lf-input" name="status" defaultValue={query.status ?? ''}>
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
          </select>
        </div>
        <div className="lf-field" style={{ margin: 0 }}>
          <label className="lf-label" htmlFor="fa-from">
            From
          </label>
          <input id="fa-from" className="lf-input" type="date" name="from" defaultValue={iso(from)} />
        </div>
        <div className="lf-field" style={{ margin: 0 }}>
          <label className="lf-label" htmlFor="fa-to">
            To
          </label>
          <input id="fa-to" className="lf-input" type="date" name="to" defaultValue={iso(to)} />
        </div>
        <button className="lf-btn" type="submit">
          Search
        </button>
        <SalesLink className="lf-btn lf-btn--secondary" href="/face-activity">
          Clear filters
        </SalesLink>
        <ExportCsv filename={`face-activity-${iso(from)}-to-${iso(to)}.csv`} csv={csv} />
      </form>

      <h2 className="lf-leave__section">Consent register</h2>
      {consents.length === 0 ? (
        <div className="lf-card lf-leave__empty">No biometric consent has been recorded.</div>
      ) : (
        <WorkspaceTable
          headers={['Employee', 'Granted', 'Withdrawn', 'Policy']}
          rows={consents.map((consent) => [
            employees.find((employee) => employee.id === consent.employeeId)?.membership.platformUser.fullName ??
              consent.employeeId,
            consent.grantedAt ? stamp(consent.grantedAt) : '—',
            consent.withdrawnAt ? stamp(consent.withdrawnAt) : '—',
            consent.policyVersion ?? '—',
          ])}
          searchable
          searchPlaceholder="Employee or policy version…"
          searchLabel="Search the register"
        />
      )}

      <h2 className="lf-leave__section">Verification events</h2>
      {rows.length === 0 ? (
        <div className="lf-card lf-leave__empty">No face recognition activity in this period.</div>
      ) : (
        <WorkspaceTable
          headers={[
            'Employee',
            'When',
            'Event',
            'Liveness',
            'Match',
            'Location',
            'Distance',
            'Accuracy',
            'Geofence',
            'Status',
            'Reason',
          ]}
          rows={rows.map((row) => [
            <div key="who">
              {row.employee}
              <div style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-2xs)' }}>{row.employeeNumber}</div>
            </div>,
            row.at,
            row.event,
            row.liveness,
            row.match,
            row.location,
            row.distance,
            row.accuracy,
            row.inside,
            <span
              key="status"
              className="lf-badge"
              style={{ color: row.ok ? 'var(--lf-viridian)' : 'var(--lf-vermillion, #b3261e)' }}
            >
              {row.status}
            </span>,
            row.reason,
          ])}
          searchable
          searchPlaceholder="Employee, location, status or reason…"
          searchLabel="Search these events"
        />
      )}
    </div>
  );
}
