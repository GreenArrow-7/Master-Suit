import { prisma } from '@/lib/db';
import { resolveWorkspacePage, SELF_SERVICE } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import PageHeader from '@/components/ui/PageHeader';

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

  const [people, sales] = await Promise.all([peopleQuery, salesQuery]);

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
      {!people && !sales && !showSubscription && (
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
