import { requirePageAccess } from '@/lib/workspace-page';
import { mergeWhere } from '@/lib/api/where';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import Badge, { type Tone } from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import { whoseWork } from '@/components/workspace/WhoseWork';
import { can, atLeast, scopeFor } from '@/lib/security/rbac';
import { assignableUsers, workListScope } from '@/lib/security/record-scope';
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

/** A filter keeps the view, and the view keeps the filter. */
function tabHref(tab: string, mine: boolean): string {
  const query = new URLSearchParams([...(mine ? [['view', 'mine']] : []), ...(tab ? [['tab', tab]] : [])]);
  return query.toString() ? `/tasks?${query}` : '/tasks';
}

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ tab?: string; view?: string }> }) {
  const params = await searchParams;
  // Lead work, so every product that works leads: a Lead-Eagle-only workspace had
  // no list of its team's tasks, only each lead's Tasks tab.
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['tasks', 'VIEW'] });
  // Everyone the viewer's tasks scope covers, or their own under Mine.
  const view = whoseWork(scopeFor(ctx, 'tasks', 'VIEW'), params.view);
  const scope = await workListScope(ctx, 'tasks', view.mine);
  const now = new Date();

  const canCreate = can(ctx, 'leads', 'EDIT');
  const canAssignOthers = atLeast(ctx, 'leads', 'ASSIGN', 'TEAM');

  const [rows, taskTypes, assignees] = await Promise.all([
    prisma.task.findMany({
      where: mergeWhere(scope, { deletedAt: null }, tabWhere(params.tab, now)),
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
    canAssignOthers ? assignableUsers(ctx, 'leads', 'ASSIGN') : Promise.resolve([]),
  ]);

  return (
    <>
      <ListHeader title="Tasks" description={view.count(rows.length, rows.length === 100, 'task')} />

      {canCreate && (
        <div style={{ marginBottom: 'var(--lf-space-4)' }}>
          <TaskComposer taskTypes={taskTypes} assignees={assignees} canAssignOthers={canAssignOthers} />
        </div>
      )}

      {view.tabs((mine) => tabHref(params.tab ?? '', mine))}

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Task filter">
        {TABS.map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={tabHref(key, params.view === 'mine')}
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
            description={
              canCreate ? 'Adjust the filter, or create a task with the button above.' : 'Adjust the filter.'
            }
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
                    <td>{t.lead ? <SalesLink href={`/leads/${t.lead.id}`}>{t.lead.fullName}</SalesLink> : '—'}</td>
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
                      {canCreate ? (
                        <TaskRowActions id={t.id} status={t.status} canDelete={can(ctx, 'tasks', 'DELETE')} />
                      ) : null}
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
