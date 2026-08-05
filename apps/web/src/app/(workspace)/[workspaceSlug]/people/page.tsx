import Link from 'next/link';
import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import PageHeader from '@/components/ui/PageHeader';
import { lifecycleDashboard } from '@/services/hr/lifecycle';

export default async function PeopleOverview({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, 'HRMS');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const [employees, departments, present, pendingLeave, lifecycle] = await Promise.all([
    prisma.employeeProfile.count({ where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: 'ACTIVE' } }),
    prisma.department.count({ where: { tenantId: ctx.tenantId, deletedAt: null } }),
    prisma.hrAttendanceRecord.count({ where: { tenantId: ctx.tenantId, workDate: { gte: today, lt: tomorrow }, status: { in: ['PRESENT', 'LATE', 'REMOTE'] } } }),
    prisma.hrLeaveRequest.count({ where: { tenantId: ctx.tenantId, status: 'PENDING' } }),
    lifecycleDashboard(ctx),
  ]);
  // The lifecycle numbers are what actually needs acting on: an expired visa or an
  // overdue blocking step stops someone working, unlike a headcount.
  const metrics: [string, number][] = [
    ['Employees', employees], ['Departments', departments], ['Present today', present], ['Pending leave', pendingLeave],
    ['Joining', lifecycle.joining.length], ['On notice', lifecycle.leaving.length],
    ['Overdue tasks', lifecycle.overdueTasks], ['Documents expired', lifecycle.documentsExpired],
  ];
  return <div className="lf-page-stack">
    <PageHeader eyebrow="People / HRMS" title="People overview" description="Monitor workforce availability, attendance and pending requests." breadcrumbs={[{ label: 'Workspace', href: `/${workspaceSlug}/dashboard` }, { label: 'People' }]} actions={<Link className="lf-btn" href={`/${workspaceSlug}/people/employees/new`}>Add employee</Link>} />
    <div className="lf-metric-grid">{metrics.map(([label, value]) => <article className="lf-metric-card" key={label}><div className="lf-eyebrow">{label}</div><div className="lf-metric-card__value">{value}</div></article>)}</div>
  </div>;
}
