import { prisma } from '@/lib/db';
import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';
import { myEmployee } from '@/services/hr/leave';
import { faceStatus, myPunches, openCheckIn } from '@/services/hr/attendance';
import CheckInConsole, { type RecentPunch } from './CheckInConsole';

export const metadata = { title: 'Check in' };

/**
 * The attendance console, per the reference screen: live GST clock, circular
 * camera viewport, LIVE / IDENTITY / ON SITE verdicts, the assigned location
 * and its geofence, the GPS diagnostic, the actions, and Recent.
 *
 * The page only gathers what the console needs to render its first frame —
 * assignment names, radii and check-out rule, consent and enrolment state. It
 * deliberately never hands the browser a coordinate: distance and the geofence
 * verdict are computed server-side on every read, because a client-reported
 * position is exactly what an attacker would forge.
 */
export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: SELF_SERVICE });
  const actions = `/api/v1/workspaces/${workspaceSlug}/hr/actions`;

  const employee = await myEmployee(ctx);
  if (!employee) {
    return (
      <section className="lf-card" style={{ padding: 'var(--lf-space-6)' }}>
        <h1>Check in</h1>
        <p style={{ color: 'var(--lf-ink-2)' }}>
          Your account has no employee record in this workspace, so there is nothing to record attendance against. Ask
          HR to create one.
        </p>
      </section>
    );
  }

  const [status, punches, open, assignments] = await Promise.all([
    faceStatus(ctx),
    myPunches(ctx, 8),
    openCheckIn(ctx, employee.id),
    prisma.hrEmployeeLocationAssignment.findMany({
      where: { tenantId: ctx.tenantId, employeeId: employee.id, status: 'ACTIVE' },
      include: { location: { select: { name: true, radiusMeters: true } } },
    }),
  ]);

  const recent: RecentPunch[] = punches.map((row) => ({
    id: row.id,
    type: row.punchType,
    at: row.serverTime.toISOString(),
    result: row.result,
    location: row.location?.name ?? null,
    distanceM: row.distanceM,
    reason: row.rejectReason,
  }));

  return (
    <div className="lf-page-stack">
      <CheckInConsole
        endpointBase={actions}
        assigned={assignments.map((assignment) => ({
          name: assignment.location.name,
          radiusMeters: assignment.location.radiusMeters,
          checkoutRule: assignment.checkoutRule,
        }))}
        consented={!!status.consentGrantedAt}
        enrolled={status.enrolled}
        engineReady={status.engineReady}
        openCheckIn={!!open}
        initialRecent={recent}
      />
    </div>
  );
}
