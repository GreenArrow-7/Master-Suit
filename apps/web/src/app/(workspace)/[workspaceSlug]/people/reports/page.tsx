import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import WorkspaceTable from '@/components/workspace/WorkspaceTable';
export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });
  const [departments, leave, attendance] = await Promise.all([
    prisma.department.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      include: { _count: { select: { employees: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.hrLeaveRequest.groupBy({ by: ['status'], where: { tenantId: ctx.tenantId }, _count: true }),
    prisma.hrAttendanceRecord.groupBy({ by: ['status'], where: { tenantId: ctx.tenantId }, _count: true }),
  ]);
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div>
        <div className="lf-eyebrow">People</div>
        <h1 style={{ margin: '8px 0 0' }}>HR reports</h1>
      </div>
      <WorkspaceTable
        headers={['Department', 'Employees']}
        rows={departments.map((r) => [r.name, r._count.employees])}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <WorkspaceTable headers={['Leave status', 'Requests']} rows={leave.map((r) => [r.status, r._count])} />
        <WorkspaceTable headers={['Attendance status', 'Records']} rows={attendance.map((r) => [r.status, r._count])} />
      </div>
    </div>
  );
}
