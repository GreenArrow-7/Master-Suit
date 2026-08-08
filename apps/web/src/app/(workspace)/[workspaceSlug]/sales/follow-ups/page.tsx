import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import { columnsFor } from '@/lib/grid/resolve';
import { can } from '@/lib/security/rbac';

export const metadata = { title: 'Follow-ups' };

const TABS = [
  ['All', ''],
  ['Overdue', 'overdue'],
  ['Today', 'today'],
  ['Upcoming', 'upcoming'],
] as const;

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ due?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['leads', 'VIEW'] });
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const where: Record<string, unknown> = {
    tenantId: ctx.tenantId,
    ownerId: ctx.actor.id,
    status: { in: ['OPEN', 'IN_PROGRESS'] },
    deletedAt: null,
  };

  if (params.due === 'overdue') where.dueAt = { lt: now };
  else if (params.due === 'today') where.dueAt = { gte: now, lte: todayEnd };
  else if (params.due === 'upcoming') where.dueAt = { gt: todayEnd };

  const rows = await prisma.followUpTask.findMany({ where, orderBy: { dueAt: 'asc' }, take: 100 });

  // FollowUpTask carries a bare leadId with no relation, so the name is looked up
  // here. The column previously showed the first eight characters of the cuid,
  // which identified nothing to the person reading it.
  const leadIds = [...new Set(rows.map((row) => row.leadId).filter((id): id is string => Boolean(id)))];
  const leads =
    leadIds.length > 0
      ? await prisma.lead.findMany({
          where: { tenantId: ctx.tenantId, id: { in: leadIds } },
          select: { id: true, fullName: true },
        })
      : [];
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const followUps = rows.map((row) => ({
    ...row,
    lead: row.leadId ? (leadById.get(row.leadId) ?? null) : null,
  }));

  const columns = await columnsFor(ctx.tenantId, 'FOLLOWUP');

  return (
    <>
      <ListHeader
        title="Follow-ups"
        count={rows.length}
        capped={rows.length === 100}
        actions={
          can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
            <ColumnEditor object="FOLLOWUP" current={columns.map((c) => c.key)} />
          )
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Due filter">
        {TABS.map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/follow-ups?due=${key}` : '/follow-ups'}
            aria-selected={(params.due ?? '') === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState title="No follow-ups" description="Follow-up tasks will appear here." />
        </div>
      ) : (
        <ConfigurableGrid object="FOLLOWUP" columns={columns} rows={followUps as any} />
      )}
    </>
  );
}
