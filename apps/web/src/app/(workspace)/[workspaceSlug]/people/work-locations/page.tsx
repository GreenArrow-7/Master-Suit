import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceRecordForm from '@/components/workspace/WorkspaceRecordForm';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
import WorkspaceActionButton from '@/components/workspace/WorkspaceActionButton';
import { isHrAdmin } from '@/services/hr/leave';

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });
  const base = `/api/v1/workspaces/${workspaceSlug}/hr`;
  const hr = isHrAdmin(ctx);

  const [locations, employees, assignments] = await Promise.all([
    prisma.hrWorkLocation.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } }),
    prisma.employeeProfile.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
      include: { membership: { include: { platformUser: true } } },
      orderBy: { employeeNumber: 'asc' },
    }),
    prisma.hrEmployeeLocationAssignment.findMany({
      where: { tenantId: ctx.tenantId },
      include: { location: true, employee: { include: { membership: { include: { platformUser: true } } } } },
      orderBy: { assignedAt: 'desc' },
      take: 200,
    }),
  ]);

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-6)' }}>
      <section>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>Work locations</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--lf-ink-600)' }}>
          The geofence attendance is measured against. Coordinates never reach the browser during a punch — the distance
          is computed on the server, because a client-reported &ldquo;I am inside&rdquo; is exactly what an attacker
          would forge. A location left in <strong>DRAFT</strong> is not a candidate for any check-in.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Add a location</h2>
        <WorkspaceRecordForm
          endpoint={`${base}/work-locations`}
          submitLabel="Create location"
          fields={[
            { name: 'name', label: 'Location name', required: true },
            { name: 'code', label: 'Code' },
            {
              name: 'latitude',
              label: 'Latitude (stand in the office and read your phone GPS)',
              type: 'number',
              required: true,
            },
            { name: 'longitude', label: 'Longitude', type: 'number', required: true },
            { name: 'radiusMeters', label: 'Radius (metres)', type: 'number', required: true, placeholder: '150' },
            {
              name: 'maxAccuracyMeters',
              label: 'Worst acceptable GPS accuracy (metres)',
              type: 'number',
              placeholder: '100',
            },
            { name: 'openingTime', label: 'Opening time', type: 'time' },
            { name: 'closingTime', label: 'Closing time', type: 'time' },
            { name: 'emirate', label: 'Emirate' },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: [
                { value: 'ACTIVE', label: 'Active' },
                { value: 'DRAFT', label: 'Draft' },
                { value: 'RETIRED', label: 'Retired' },
              ],
            },
          ]}
        />
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Locations</h2>
        <WorkspaceTable
          headers={['Location', 'Coordinates', 'Radius', 'Max GPS error', 'Hours', 'Status']}
          rows={locations.map((location) => [
            location.name,
            `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`,
            `${location.radiusMeters} m`,
            `${location.maxAccuracyMeters} m`,
            location.openingTime && location.closingTime ? `${location.openingTime}–${location.closingTime}` : 'Any',
            <span className="lf-badge" key="s">
              {location.status}
            </span>,
          ])}
        />
      </section>

      {hr && (
        <section>
          <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Assign an employee to a location</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--lf-ink-600)', fontSize: 'var(--lf-text-sm)' }}>
            Without an active assignment no check-in is accepted at all.
          </p>
          <WorkspaceRecordForm
            endpoint={`${base}/location-assignments`}
            submitLabel="Assign"
            fields={[
              {
                name: 'employeeId',
                label: 'Employee',
                type: 'select',
                required: true,
                options: employees.map((employee) => ({
                  value: employee.id,
                  label: `${employee.employeeNumber} · ${employee.membership.platformUser.fullName}`,
                })),
              },
              {
                name: 'locationId',
                label: 'Location',
                type: 'select',
                required: true,
                options: locations.map((location) => ({
                  value: location.id,
                  label: `${location.name} (${location.status})`,
                })),
              },
              {
                name: 'assignmentType',
                label: 'Type',
                type: 'select',
                options: ['PRIMARY', 'SECONDARY', 'TEMPORARY'].map((value) => ({ value, label: value.toLowerCase() })),
              },
              { name: 'effectiveFrom', label: 'Effective from', type: 'date' },
              { name: 'effectiveTo', label: 'Effective to', type: 'date' },
              {
                name: 'checkoutRule',
                label: 'Check-out rule',
                type: 'select',
                options: [
                  { value: 'SAME_LOCATION', label: 'Must check out where they checked in' },
                  { value: 'ANY_ASSIGNED', label: 'Any assigned location' },
                  { value: 'EXCEPTION_ONLY', label: 'Requires an approved exception' },
                ],
              },
              { name: 'notes', label: 'Notes' },
            ]}
          />
        </section>
      )}

      <section>
        <h2 style={{ fontSize: 'var(--lf-text-lg)', margin: '0 0 10px' }}>Assignments</h2>
        <WorkspaceTable
          headers={['Employee', 'Location', 'Type', 'Window', 'Check-out rule', 'Status', '']}
          empty="Nobody is assigned to a work location yet, so no check-in can succeed."
          rows={assignments.map((assignment) => [
            assignment.employee.membership.platformUser.fullName,
            assignment.location.name,
            assignment.assignmentType.toLowerCase(),
            `${assignment.effectiveFrom ? date(assignment.effectiveFrom) : 'always'} – ${assignment.effectiveTo ? date(assignment.effectiveTo) : 'open'}`,
            assignment.checkoutRule.replace(/_/g, ' ').toLowerCase(),
            <span className="lf-badge" key="s">
              {assignment.status}
            </span>,
            hr && assignment.status === 'ACTIVE' ? (
              <WorkspaceActionButton
                key="revoke"
                endpoint={`${base}/actions/location-revoke`}
                body={{ assignmentId: assignment.id }}
                label="Revoke"
                variant="ghost"
                promptFor={{ name: 'reason', label: 'Reason', required: false }}
              />
            ) : (
              '—'
            ),
          ])}
        />
      </section>
    </div>
  );
}

const date = (value: Date) => value.toLocaleDateString('en-AE', { timeZone: 'UTC' });
