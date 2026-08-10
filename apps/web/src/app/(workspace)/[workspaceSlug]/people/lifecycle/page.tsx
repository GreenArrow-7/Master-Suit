import { prisma } from '@/lib/db';
import { resolveWorkspacePage } from '@/lib/workspace-page';
import { isHrAdmin } from '@/services/hr/access';
import { checklistFor, expiringDocuments, lifecycleDashboard } from '@/services/hr/lifecycle';
import LifecycleScreen, { type ChecklistTask, type ExpiringDoc, type JourneyRow, type Person } from './LifecycleScreen';

export const metadata = { title: 'People' };

const day = (value: Date | null) =>
  value
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric' }).format(
        value,
      )
    : null;

/**
 * People — joining and leaving, per the reference: the KPI row, the two start
 * modes, the joining/leaving list beside the selected person's checklist, and
 * documents expiring.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ employee?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { employee: selected } = await searchParams;
  const { ctx } = await resolveWorkspacePage(workspaceSlug, { module: 'HRMS', permission: ['employee', 'VIEW'] });
  const actions = `/api/v1/workspaces/${workspaceSlug}/hr/actions`;
  const canManage = isHrAdmin(ctx);

  const [dashboard, documents, staff, tasks] = await Promise.all([
    lifecycleDashboard(ctx),
    expiringDocuments(ctx, 90),
    canManage
      ? prisma.employeeProfile.findMany({
          where: { tenantId: ctx.tenantId, deletedAt: null, employmentStatus: { notIn: ['EXITED'] } },
          include: { membership: { include: { platformUser: { select: { fullName: true } } } } },
          orderBy: { employeeNumber: 'asc' },
        })
      : Promise.resolve([]),
    selected ? checklistFor(ctx, selected) : Promise.resolve([]),
  ]);

  const kpis: [string, number, boolean][] = [
    ['Joining', dashboard.joining.length, false],
    ['Leaving', dashboard.leaving.length, false],
    ['Overdue tasks', dashboard.overdueTasks, true],
    ['Docs expiring 60d', dashboard.documentsExpiring60d, false],
    ['Docs expired', dashboard.documentsExpired, false],
  ];

  const journeys: JourneyRow[] = [
    ...dashboard.joining.map((row) => ({
      employeeId: row.employeeId,
      name: row.name,
      employeeNumber: row.employeeNumber,
      when: day(row.joinedOn),
      openBlockers: row.openBlockers,
      phase: 'Joining' as const,
    })),
    ...dashboard.leaving.map((row) => ({
      employeeId: row.employeeId,
      name: row.name,
      employeeNumber: row.employeeNumber,
      when: day(row.exitedOn),
      openBlockers: row.openBlockers,
      phase: 'Leaving' as const,
    })),
  ];

  return (
    <div className="lf-page-stack">
      <section>
        <h1 style={{ margin: 0 }}>People</h1>
      </section>

      <div className="lf-life__kpis">
        {kpis.map(([label, value, accent]) => (
          <article className="lf-card lf-life__kpi" key={label} data-accent={accent && value > 0}>
            <div className="lf-eyebrow">{label}</div>
            <div className="lf-life__kpi-value">{value}</div>
          </article>
        ))}
      </div>

      <LifecycleScreen
        actionsBase={actions}
        canManage={canManage}
        selected={selected ?? null}
        people={staff.map(
          (person): Person => ({
            employeeId: person.id,
            name: person.membership.platformUser.fullName,
            employeeNumber: person.employeeNumber,
          }),
        )}
        journeys={journeys}
        checklist={tasks.map(
          (task): ChecklistTask => ({
            id: task.id,
            title: task.title,
            owner: task.ownerDepartment ?? '—',
            dueOn: day(task.dueDate),
            status: task.completedAt ? 'DONE' : task.overdue ? 'OVERDUE' : 'OPEN',
          }),
        )}
        expiring={documents.map(
          (document): ExpiringDoc => ({
            employeeName: document.employeeName,
            kind: document.kind,
            expiresAt: day(document.expiresAt) ?? '—',
            daysRemaining: document.daysRemaining,
          }),
        )}
      />
    </div>
  );
}
