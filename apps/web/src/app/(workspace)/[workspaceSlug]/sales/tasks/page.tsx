import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import { columnsFor } from '@/lib/grid/resolve';
import { can } from '@/lib/security/rbac';

export const metadata = { title: 'Tasks' };

const TABS = [
  ['All', ''],
  ['Open', 'open'],
  ['Overdue', 'overdue'],
  ['Completed', 'completed'],
  ['Cancelled', 'cancelled'],
] as const;

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

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['tasks', 'VIEW'] });
  const scope = await visibilityWhere(ctx, 'tasks', 'VIEW', { ownerField: 'ownerId' });
  const now = new Date();

  const rows = await prisma.task.findMany({
    where: { ...scope, deletedAt: null, ...tabWhere(params.tab, now) },
    orderBy: tabOrder(params.tab),
    take: 50,
    select: {
      id: true,
      title: true,
      dueAt: true,
      completedAt: true,
      priority: true,
      status: true,
      type: { select: { key: true, name: true } },
      lead: { select: { id: true, fullName: true } },
      owner: { select: { fullName: true } },
    },
  });

  const columns = await columnsFor(ctx.tenantId, 'TASK');

  return (
    <>
      <ListHeader
        title="Tasks"
        description={
          <>
            {rows.length === 50 ? 'First 50 records' : `${rows.length} record${rows.length === 1 ? '' : 's'}`} in your
            scope
          </>
        }

        actions={
          can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
            <ColumnEditor object="TASK" current={columns.map((c) => c.key)} />
          )
        }
      />

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
          <EmptyState title="No tasks match" description="Adjust the filter or create a task to get started." />
        </div>
      ) : (
        <ConfigurableGrid object="TASK" columns={columns} rows={rows as any} />
      )}
    </>
  );
}
