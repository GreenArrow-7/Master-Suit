import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import { isApprover, isHrAdmin } from '@/services/hr/access';
import { myEmployee } from '@/services/hr/leave';
import { EXCEPTION_REASONS, listExceptionRequests, listTemporaryRequests } from '@/services/hr/requests';

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });
  const actions = `/api/v1/workspaces/${workspaceSlug}/hr/actions`;

  const self = await myEmployee(ctx);
  if (!self) {
    return (
      <section className="lf-card" style={{ padding: 'var(--lf-space-6)' }}>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>Requests</h1>
        <p style={{ color: 'var(--lf-ink-2)' }}>
          Your account has no employee record in this workspace, so there is nothing to raise a request against.
        </p>
      </section>
    );
  }

  const hr = isHrAdmin(ctx);
  const reviewer = hr || isApprover(ctx);

  const [temporary, exceptions, employees] = await Promise.all([
    listTemporaryRequests(ctx),
    listExceptionRequests(ctx),
    prisma.employeeProfile.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
      include: { membership: { include: { platformUser: true } } },
      orderBy: { employeeNumber: 'asc' },
    }),
  ]);

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
      <section>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>Requests</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-2)', maxWidth: '80ch' }}>
          The two authorised routes around the geofence. A geofence that can only say no is one people work around — an
          agent at a client site, or someone whose phone died at the door, needs a path that ends in a human decision.
          Neither route weakens the fence: an approved temporary site becomes a real, date-bounded location, and an
          approved exception writes a corrected punch while leaving the original refusal in the log as evidence.
        </p>
      </section>

      {/* ── Attendance exceptions ─────────────────────────────────────────── */}
      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Raise an attendance exception</h2>
        <p style={{ margin: '0 0 10px', color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
          For a check-in or check-out that could not happen normally. Your line manager decides first, then HR.
        </p>
        <WorkspaceRecordForm
          endpoint={`${actions}/exception-request`}
          submitLabel="Submit exception"
          fields={[
            {
              name: 'requestedAction',
              label: 'What was missed',
              type: 'select',
              required: true,
              options: [
                { value: 'CHECK_IN', label: 'Check in' },
                { value: 'CHECK_OUT', label: 'Check out' },
              ],
            },
            {
              name: 'requestedFor',
              label: 'When it should have been recorded',
              type: 'datetime-local',
              required: true,
            },
            {
              name: 'reasonCode',
              label: 'Reason',
              type: 'select',
              required: true,
              options: EXCEPTION_REASONS.map((reason) => ({ value: reason, label: reason.replace(/_/g, ' ') })),
            },
            { name: 'reasonText', label: 'What happened' },
            { name: 'attachmentName', label: 'Supporting document reference' },
          ]}
        />
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Attendance exceptions</h2>
        <WorkspaceTable
          headers={['Employee', 'Action', 'For', 'Reason', 'Nearest site', 'Stage', 'Decision']}
          empty="No attendance exceptions have been raised."
          rows={exceptions.map((request) => {
            const atManagerStage = request.status === 'PENDING_MANAGER';
            const atHrStage = request.status === 'PENDING_HR';
            const mayDecide = request.employeeId !== self.id && ((atManagerStage && reviewer) || (atHrStage && hr));
            return [
              request.employee.membership.platformUser.fullName,
              request.requestedAction === 'CHECK_IN' ? 'Check in' : 'Check out',
              request.requestedFor.toLocaleString('en-AE', { timeZone: 'UTC' }),
              <span key="r">
                {request.reasonCode.replace(/_/g, ' ')}
                {request.reasonText ? (
                  <div style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)' }}>{request.reasonText}</div>
                ) : null}
              </span>,
              request.nearestLocation?.name
                ? `${request.nearestLocation.name}${request.distanceM == null ? '' : ` · ${Math.round(request.distanceM)} m`}`
                : '—',
              <span className="lf-badge" key="s">
                {request.status.replace(/_/g, ' ').toLowerCase()}
              </span>,
              mayDecide ? (
                <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} key="d">
                  <WorkspaceActionButton
                    endpoint={`${actions}/exception-decide`}
                    body={{ requestId: request.id, approve: true }}
                    label={atManagerStage ? 'Endorse' : 'Approve'}
                    promptFor={{ name: 'comment', label: 'Comment' }}
                  />
                  <WorkspaceActionButton
                    endpoint={`${actions}/exception-decide`}
                    body={{ requestId: request.id, approve: false }}
                    label="Reject"
                    variant="danger"
                    promptFor={{ name: 'comment', label: 'Reason for rejection' }}
                  />
                </span>
              ) : (
                <span key="d" style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)' }}>
                  {request.hrComment ?? request.managerComment ?? '—'}
                </span>
              ),
            ];
          })}
        />
      </section>

      {/* ── Temporary work locations ──────────────────────────────────────── */}
      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Request a temporary work location</h2>
        <p style={{ margin: '0 0 10px', color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
          For a site that is not an approved location — a project office, an exhibition stand, a client&apos;s premises.
          On approval it becomes a real work location with hard start and end dates, and the named staff are assigned to
          it for that window only.
        </p>
        <WorkspaceRecordForm
          endpoint={`${actions}/temporary-request`}
          submitLabel="Submit request"
          fields={[
            { name: 'name', label: 'Site name', required: true },
            {
              name: 'employeeIds',
              label: 'Employee covered',
              type: 'select',
              required: true,
              options: employees.map((employee) => ({
                value: employee.id,
                label: `${employee.employeeNumber} · ${employee.membership.platformUser.fullName}`,
              })),
            },
            { name: 'latitude', label: 'Latitude', type: 'number', required: true },
            { name: 'longitude', label: 'Longitude', type: 'number', required: true },
            { name: 'radiusMeters', label: 'Radius (metres)', type: 'number', required: true, placeholder: '150' },
            { name: 'validFrom', label: 'Valid from', type: 'date', required: true },
            { name: 'validTo', label: 'Valid to', type: 'date', required: true },
            { name: 'reason', label: 'Why this site is needed', required: true },
          ]}
        />
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Temporary work locations</h2>
        <WorkspaceTable
          headers={['Site', 'Window', 'Covers', 'Requested by', 'Status', 'Decision']}
          empty="No temporary work locations have been requested."
          rows={temporary.map((request) => [
            <span key="n">
              {request.name}
              <div style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)' }}>{request.reason}</div>
            </span>,
            `${date(request.validFrom)} – ${date(request.validTo)}`,
            `${request.employeeIds.length} employee${request.employeeIds.length === 1 ? '' : 's'}`,
            request.requestedBy.membership.platformUser.fullName,
            <span className="lf-badge" key="s">
              {request.status.toLowerCase()}
            </span>,
            // The requester never decides their own, however senior they are.
            hr && request.status === 'PENDING' && request.requestedById !== self.id ? (
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} key="d">
                <WorkspaceActionButton
                  endpoint={`${actions}/temporary-decide`}
                  body={{ requestId: request.id, approve: true }}
                  label="Approve"
                  confirm="Approving creates a live work location and assigns the named staff to it for the requested window."
                />
                <WorkspaceActionButton
                  endpoint={`${actions}/temporary-decide`}
                  body={{ requestId: request.id, approve: false }}
                  label="Reject"
                  variant="danger"
                  promptFor={{ name: 'note', label: 'Reason', required: false }}
                />
              </span>
            ) : (
              <span key="d" style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)' }}>
                {request.decisionNote ?? (request.createdLocation ? `Live as “${request.createdLocation.name}”` : '—')}
              </span>
            ),
          ])}
        />
      </section>
    </div>
  );
}

const date = (value: Date) => value.toLocaleDateString('en-AE', { timeZone: 'UTC' });
