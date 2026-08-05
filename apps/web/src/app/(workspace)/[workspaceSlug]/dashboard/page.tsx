import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import PageHeader from '@/components/ui/PageHeader';

export default async function WorkspaceDashboard({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx, workspace } = await resolveWorkspacePage(workspaceSlug);
  const modules = new Set(workspace.moduleEntitlements.filter((item) => ['TRIAL', 'ACTIVE', 'GRACE'].includes(item.state)).map((item) => item.module));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  const people = modules.has('HRMS') ? await Promise.all([
    prisma.employeeProfile.count({ where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: 'ACTIVE' } }),
    prisma.hrAttendanceRecord.count({ where: { tenantId: ctx.tenantId, workDate: { gte: today, lt: tomorrow }, status: { in: ['PRESENT', 'LATE', 'REMOTE'] } } }),
    prisma.hrAttendanceRecord.count({ where: { tenantId: ctx.tenantId, workDate: { gte: today, lt: tomorrow }, status: 'ABSENT' } }),
    prisma.hrLeaveRequest.count({ where: { tenantId: ctx.tenantId, status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today } } }),
    prisma.hrLeaveRequest.count({ where: { tenantId: ctx.tenantId, status: 'PENDING' } }),
    prisma.hrHoliday.count({ where: { tenantId: ctx.tenantId, holidayDate: { gte: today } } }),
  ]) : null;
  const sales = modules.has('SALES') ? await Promise.all([
    prisma.lead.count({ where: { tenantId: ctx.tenantId, deletedAt: null } }),
    prisma.lead.count({ where: { tenantId: ctx.tenantId, deletedAt: null, ownerId: null } }),
    prisma.opportunity.count({ where: { tenantId: ctx.tenantId, deletedAt: null, status: 'OPEN' } }),
    prisma.followUpTask.count({ where: { tenantId: ctx.tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lt: new Date() } } }),
    prisma.opportunity.aggregate({ where: { tenantId: ctx.tenantId, deletedAt: null, status: 'OPEN' }, _sum: { amount: true } }),
    prisma.task.count({ where: { tenantId: ctx.tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lte: tomorrow } } }),
  ]) : null;

  return <div className="lf-page-stack">
    <PageHeader eyebrow={workspace.displayName} title="Business overview" description="People, Sales and subscription health for this workspace." breadcrumbs={[{ label: workspace.displayName }, { label: 'Overview' }]} />
    {people && <Summary title="People summary" values={[
      ['Total employees', people[0]], ['Present today', people[1]], ['Absent today', people[2]], ['On leave', people[3]], ['Pending approvals', people[4]], ['Upcoming holidays', people[5]],
    ]} />}
    {sales && <Summary title="Sales summary" values={[
      ['Total leads', sales[0]], ['Unassigned leads', sales[1]], ['Open opportunities', sales[2]], ['Overdue follow-ups', sales[3]], ['Pipeline value', `${workspace.currency} ${sales[4]._sum.amount ?? 0}`], ['Tasks due', sales[5]],
    ]} />}
    <Summary title="Subscription" values={[
      ['Current plan', workspace.subscription?.plan.name ?? workspace.planCode],
      ['Enabled modules', [...modules].join(' + ')],
      ['Users', `${workspace._count.memberships} / ${workspace.maxUsers ?? '∞'}`],
      ['Employees', `${workspace._count.employeeProfiles} / ${workspace.maxEmployees ?? '∞'}`],
      ['Status', workspace.subscription?.state ?? 'NONE'],
      ['Trial / renewal', workspace.trialEndsAt?.toLocaleDateString('en-AE') ?? workspace.subscription?.currentPeriodEnd?.toLocaleDateString('en-AE') ?? 'Not set'],
    ]} />
  </div>;
}

function Summary({ title, values }: { title: string; values: [string, string | number][] }) {
  return <section><h2 className="lf-h2" style={{ marginBottom: 10 }}>{title}</h2><div className="lf-metric-grid">{values.map(([label, value]) => <article className="lf-metric-card" key={label}><div className="lf-eyebrow">{label}</div><div className="lf-metric-card__value">{value}</div></article>)}</div></section>;
}
