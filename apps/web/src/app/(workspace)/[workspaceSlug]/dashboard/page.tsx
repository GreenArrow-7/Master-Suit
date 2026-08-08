import { prisma } from '@/lib/db';
import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import PageHeader from '@/components/ui/PageHeader';
import { myEmployee } from '@/services/hr/leave';

/**
 * The workspace landing page. Reachable by every member — which is why each
 * panel is gated on its own.
 *
 * It previously rendered headcount, today's absences, the pending leave queue
 * *and* the plan, seat usage and renewal date to anyone who could log in. A
 * sales representative has no business reading either. A panel the viewer may
 * not see is simply absent: a 403 on the landing page would be worse, and
 * telling someone a section exists but is denied leaks the same thing the
 * numbers would.
 */
export default async function WorkspaceDashboard({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx, workspace } = await resolveWorkspacePage(workspaceSlug, { permission: SELF_SERVICE });
  const modules = new Set(
    workspace.moduleEntitlements
      .filter((item) => ['TRIAL', 'ACTIVE', 'GRACE'].includes(item.state))
      .map((item) => item.module),
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Entitlement decides whether the module exists here; permission decides
  // whether *this* person sees it. Both must hold, and the queries below only
  // run when they do — an unauthorised viewer costs no database work either.
  const showPeople = modules.has('HRMS') && can(ctx, 'employee', 'VIEW');
  const showSales = modules.has('SALES') && can(ctx, 'leads', 'VIEW');
  const showSubscription = can(ctx, 'settings', 'VIEW');

  /**
   * One round of concurrency, not two.
   *
   * Each group was already batched, but `await people` then `await sales` meant
   * a workspace running both modules paid two sequential rounds — the slowest
   * People query plus the slowest Sales query, rather than the slower of the
   * two. Awaiting the pair together makes it one.
   *
   * Deliberately not cached: these are record counts, and this codebase caches
   * configuration only (see lib/redis.ts and docs/00-ARCHITECTURE.md §6). A
   * dashboard showing yesterday's pending-approval count is a dashboard nobody
   * can act on.
   */
  const peopleQuery = showPeople
    ? Promise.all([
        prisma.employeeProfile.count({
          where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: 'ACTIVE' },
        }),
        prisma.hrAttendanceRecord.count({
          where: {
            tenantId: ctx.tenantId,
            workDate: { gte: today, lt: tomorrow },
            status: { in: ['PRESENT', 'LATE', 'REMOTE'] },
          },
        }),
        prisma.hrAttendanceRecord.count({
          where: { tenantId: ctx.tenantId, workDate: { gte: today, lt: tomorrow }, status: 'ABSENT' },
        }),
        prisma.hrLeaveRequest.count({
          where: { tenantId: ctx.tenantId, status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today } },
        }),
        prisma.hrLeaveRequest.count({ where: { tenantId: ctx.tenantId, status: 'PENDING' } }),
        prisma.hrHoliday.count({ where: { tenantId: ctx.tenantId, holidayDate: { gte: today } } }),
      ])
    : null;
  const salesQuery = showSales
    ? Promise.all([
        prisma.lead.count({ where: { tenantId: ctx.tenantId, deletedAt: null } }),
        prisma.lead.count({ where: { tenantId: ctx.tenantId, deletedAt: null, ownerId: null } }),
        prisma.opportunity.count({ where: { tenantId: ctx.tenantId, deletedAt: null, status: 'OPEN' } }),
        prisma.followUpTask.count({
          where: { tenantId: ctx.tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lt: new Date() } },
        }),
        prisma.opportunity.aggregate({
          where: { tenantId: ctx.tenantId, deletedAt: null, status: 'OPEN' },
          _sum: { amount: true },
        }),
        prisma.task.count({
          where: { tenantId: ctx.tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lte: tomorrow } },
        }),
      ])
    : null;

  /**
   * The self-service panel — §55's employee dashboard.
   *
   * Ungated, because everything in it is the viewer's own record. It resolves
   * the employee first and then reads only rows keyed to them, so a member with
   * no employee profile (a platform bootstrap account) simply gets nothing
   * rather than an error.
   */
  const mineQuery = modules.has('HRMS')
    ? myEmployee(ctx).then((self) =>
        self
          ? Promise.all([
              Promise.resolve(self),
              prisma.hrAttendanceRecord.findFirst({
                where: { tenantId: ctx.tenantId, employeeId: self.id, workDate: { gte: today, lt: tomorrow } },
                select: { checkInAt: true, checkOutAt: true, status: true },
              }),
              prisma.hrLeaveRequest.count({
                where: { tenantId: ctx.tenantId, employeeId: self.id, status: 'PENDING' },
              }),
              prisma.hrOvertimeRequest.count({
                where: { tenantId: ctx.tenantId, employeeId: self.id, status: 'PENDING' },
              }),
              prisma.hrReview.count({
                where: { tenantId: ctx.tenantId, employeeId: self.id, status: 'PENDING_SELF' },
              }),
              prisma.hrPayslip.count({
                where: {
                  tenantId: ctx.tenantId,
                  employeeId: self.id,
                  run: { status: { in: ['APPROVED', 'LOCKED', 'PAID'] } },
                },
              }),
            ])
          : null,
      )
    : null;

  /**
   * What is sitting on this person's desk — §55's manager dashboard.
   *
   * Each count is gated on the permission that would let them act on it, so a
   * manager who approves leave but not overtime sees one number, not two. A
   * queue you cannot clear is noise.
   */
  const approvalsQuery = modules.has('HRMS')
    ? Promise.all([
        can(ctx, 'leave', 'APPROVE')
          ? prisma.hrLeaveRequest.count({ where: { tenantId: ctx.tenantId, status: 'PENDING' } })
          : Promise.resolve(null),
        can(ctx, 'overtime', 'APPROVE')
          ? prisma.hrOvertimeRequest.count({ where: { tenantId: ctx.tenantId, status: 'PENDING' } })
          : Promise.resolve(null),
        can(ctx, 'attendance', 'APPROVE')
          ? prisma.hrAttendancePunch.count({ where: { tenantId: ctx.tenantId, result: 'FLAGGED_REVIEW' } })
          : Promise.resolve(null),
        can(ctx, 'shifts', 'APPROVE')
          ? prisma.hrShiftChangeRequest.count({ where: { tenantId: ctx.tenantId, status: 'PENDING' } })
          : Promise.resolve(null),
        can(ctx, 'recruitment', 'APPROVE')
          ? prisma.hrRequisition.count({ where: { tenantId: ctx.tenantId, status: 'PENDING_APPROVAL' } })
          : Promise.resolve(null),
        can(ctx, 'payroll', 'APPROVE')
          ? prisma.hrPayrollRun.count({ where: { tenantId: ctx.tenantId, status: 'PENDING_APPROVAL' } })
          : Promise.resolve(null),
        can(ctx, 'performance', 'APPROVE')
          ? prisma.hrReview.count({ where: { tenantId: ctx.tenantId, status: 'CALIBRATION' } })
          : Promise.resolve(null),
      ])
    : null;

  /**
   * §55's security panel. Gated on reading the audit log, because that is the
   * authority these numbers summarise — someone who cannot open the log has no
   * business being shown the count of failed sign-ins either.
   *
   * MFA coverage counts *verified* factors: an enrolment somebody started and
   * abandoned protects nothing, and counting it would report a workspace as
   * covered when it is not.
   */
  const securityQuery = can(ctx, 'auditlogs', 'VIEW')
    ? Promise.all([
        prisma.auditLog.count({
          where: { tenantId: ctx.tenantId, event: 'LOGIN_FAILED', occurredAt: { gte: today } },
        }),
        prisma.user.count({ where: { tenantId: ctx.tenantId, status: { in: ['SUSPENDED', 'DEACTIVATED'] } } }),
        prisma.user.count({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' } }),
        prisma.workspaceMembership.count({
          where: {
            tenantId: ctx.tenantId,
            status: 'ACTIVE',
            platformUser: { authenticationFactors: { some: { verifiedAt: { not: null } } } },
          },
        }),
        prisma.auditLog.count({ where: { tenantId: ctx.tenantId, occurredAt: { gte: today } } }),
      ])
    : null;

  const [people, sales, mine, approvals, security] = await Promise.all([
    peopleQuery,
    salesQuery,
    mineQuery,
    approvalsQuery,
    securityQuery,
  ]);

  const approvalItems = approvals
    ? ([
        ['Leave to approve', approvals[0]],
        ['Overtime to approve', approvals[1]],
        ['Punches flagged', approvals[2]],
        ['Shift changes', approvals[3]],
        ['Requisitions', approvals[4]],
        ['Payroll runs', approvals[5]],
        ['Ratings to calibrate', approvals[6]],
      ].filter(([, value]) => value !== null) as [string, number][])
    : [];

  return (
    <div className="lf-page-stack">
      <PageHeader
        eyebrow={workspace.displayName}
        title="Business overview"
        description="People, Sales and subscription health for this workspace."
        breadcrumbs={[{ label: workspace.displayName }, { label: 'Overview' }]}
      />
      {people && (
        <Summary
          title="People summary"
          values={[
            ['Total employees', people[0]],
            ['Present today', people[1]],
            ['Absent today', people[2]],
            ['On leave', people[3]],
            ['Pending approvals', people[4]],
            ['Upcoming holidays', people[5]],
          ]}
        />
      )}
      {sales && (
        <Summary
          title="Sales summary"
          values={[
            ['Total leads', sales[0]],
            ['Unassigned leads', sales[1]],
            ['Open opportunities', sales[2]],
            ['Overdue follow-ups', sales[3]],
            ['Pipeline value', `${workspace.currency} ${sales[4]._sum.amount ?? 0}`],
            ['Tasks due', sales[5]],
          ]}
        />
      )}
      {showSubscription && (
        <Summary
          title="Subscription"
          values={[
            ['Current plan', workspace.subscription?.plan.name ?? workspace.planCode],
            ['Enabled modules', [...modules].join(' + ')],
            ['Users', `${workspace._count.memberships} / ${workspace.maxUsers ?? '∞'}`],
            ['Employees', `${workspace._count.employeeProfiles} / ${workspace.maxEmployees ?? '∞'}`],
            ['Status', workspace.subscription?.state ?? 'NONE'],
            [
              'Trial / renewal',
              workspace.trialEndsAt?.toLocaleDateString('en-AE') ??
                workspace.subscription?.currentPeriodEnd?.toLocaleDateString('en-AE') ??
                'Not set',
            ],
          ]}
        />
      )}
      {mine && (
        <Summary
          title="My day"
          values={[
            [
              'Today',
              mine[1]?.checkInAt
                ? mine[1].checkOutAt
                  ? 'Checked out'
                  : 'Checked in'
                : 'Not checked in',
            ],
            ['My pending leave', mine[2]],
            ['My pending overtime', mine[3]],
            ['Self-assessment due', mine[4]],
            ['Payslips available', mine[5]],
          ]}
        />
      )}
      {approvalItems.length > 0 && approvalItems.some(([, value]) => value > 0) && (
        <Summary title="Waiting on me" values={approvalItems} />
      )}
      {security && (
        <Summary
          title="Security today"
          values={[
            ['Failed sign-ins', security[0]],
            ['Locked or disabled', security[1]],
            ['Active accounts', security[2]],
            ['Two-factor coverage', security[2] ? `${Math.round((security[3] / security[2]) * 100)}%` : '—'],
            ['Audited events', security[4]],
          ]}
        />
      )}
      {!people && !sales && !mine && !security && !showSubscription && (
        <p style={{ color: 'var(--lf-ink-3)' }}>
          Nothing to show here yet. Use the navigation to reach the areas you have access to.
        </p>
      )}
    </div>
  );
}

function Summary({ title, values }: { title: string; values: [string, string | number][] }) {
  return (
    <section>
      <h2 className="lf-h2" style={{ marginBottom: 10 }}>
        {title}
      </h2>
      <div className="lf-metric-grid">
        {values.map(([label, value]) => (
          <article className="lf-metric-card" key={label}>
            <div className="lf-eyebrow">{label}</div>
            <div className="lf-metric-card__value">{value}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
