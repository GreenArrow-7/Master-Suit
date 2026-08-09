import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import Badge, { type Tone } from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import { can, scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import TaskComposer from './TaskComposer';
import TaskRowActions from './TaskRowActions';

export const metadata = { title: 'Tasks' };

const TABS = [
  ['All', ''],
  ['Open', 'open'],
  ['Overdue', 'overdue'],
  ['Completed', 'completed'],
  ['Cancelled', 'cancelled'],
] as const;

const PRIORITY_TONE: Record<string, Tone> = { URGENT: 'wine', HIGH: 'brass', MEDIUM: 'slate', LOW: 'slate' };
const STATUS_TONE: Record<string, Tone> = {
  OPEN: 'viridian',
  IN_PROGRESS: 'brass',
  COMPLETED: 'slate',
  CANCELLED: 'slate',
};

function tabWhere(tab: string | undefined, now: Date): Record<string, unknown> {
  switch (tab) {
    case 'open':
      return { status: 'OPEN' };
    case 'overdue':
      return { status: 'OPEN', dueAt: { lt: now } };
    case 'completed':
      return { status: 'COMPLETED' };
    case 'cancelled':
      return { status: 'CANCELLED' };
    default:
      return {};
  }
}

function tabOrder(tab: string | undefined): Record<string, string>[] {
  if (tab === 'completed') return [{ completedAt: 'desc' }];
  return [{ dueAt: 'asc' }];
}

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['tasks', 'VIEW'] });
  const scope = await visibilityWhere(ctx, 'tasks', 'VIEW', { ownerField: 'ownerId' });
  const now = new Date();

  const canCreate = can(ctx, 'leads', 'EDIT');
  const canAssignOthers = SCOPE_RANK[scopeFor(ctx, 'leads', 'EDIT')] >= SCOPE_RANK.TEAM;

  const [rows, taskTypes, assignees] = await Promise.all([
    prisma.task.findMany({
      where: { ...scope, deletedAt: null, ...tabWhere(params.tab, now) },
      orderBy: tabOrder(params.tab),
      take: 100,
      select: {
        id: true,
        title: true,
        dueAt: true,
        completedAt: true,
        priority: true,
        status: true,
        type: { select: { name: true } },
        lead: { select: { id: true, fullName: true } },
        owner: { select: { fullName: true } },
      },
    }),
    canCreate
      ? prisma.taskType.findMany({
          where: { tenantId: ctx.tenantId, isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    canAssignOthers
      ? prisma.user.findMany({
          where: { tenantId: ctx.tenantId, status: 'ACTIVE', deletedAt: null },
          orderBy: { fullName: 'asc' },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <ListHeader
        title="Tasks"
        description={
          <>
            {rows.length === 100 ? 'First 100 records' : `${rows.length} record${rows.length === 1 ? '' : 's'}`} in your
            scope
          </>
        }
      />

      {canCreate && (
        <div style={{ marginBottom: 'var(--lf-space-4)' }}>
          <TaskComposer taskTypes={taskTypes} assignees={assignees} canAssignOthers={canAssignOthers} />
        </div>
      )}

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Task filter">
        {TABS.map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/tasks?tab=${key}` : '/tasks'}
            aria-selected={(params.tab ?? '') === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="No tasks match"
            description={canCreate ? 'Adjust the filter, or create a task with the button above.' : 'Adjust the filter.'}
          />
        </div>
      ) : (
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th>Task</th>
                <th>Type</th>
                <th>Related lead</th>
                <th>Owner</th>
                <th>Due</th>
                <th>Priority</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const overdue = t.status === 'OPEN' && t.dueAt && new Date(t.dueAt) < now;
                return (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 500 }}>{t.title}</td>
                    <td>{t.type?.name ?? '—'}</td>
                    <td>
                      {t.lead ? <SalesLink href={`/leads/${t.lead.id}`}>{t.lead.fullName}</SalesLink> : '—'}
                    </td>
                    <td>{t.owner?.fullName ?? '—'}</td>
                    <td style={{ color: overdue ? 'var(--lf-wine-700)' : 'var(--lf-ink-2)' }}>
                      {fmt(t.dueAt)}
                      {overdue ? ' · overdue' : ''}
                    </td>
                    <td>
                      <Badge tone={PRIORITY_TONE[t.priority] ?? 'slate'}>{t.priority.toLowerCase()}</Badge>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[t.status] ?? 'slate'}>{t.status.replace(/_/g, ' ').toLowerCase()}</Badge>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {canCreate ? <TaskRowActions id={t.id} status={t.status} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
