import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import FollowUpComposer from './FollowUpComposer';
import { columnsFor } from '@/lib/grid/resolve';
import { can } from '@/lib/security/rbac';

export const metadata = { title: 'Follow-ups' };

const TABS = [
  ['All', ''],
  ['Overdue', 'overdue'],
  ['Today', 'today'],
  ['Upcoming', 'upcoming'],
  ['Completed', 'completed'],
] as const;

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ due?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['leads', 'VIEW'] });
  const now = new Date();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  /**
   * Whose follow-ups this page lists.
   *
   * `ownerId: ctx.actor.id` was the whole filter, which is right for a
   * representative and wrong for anyone reading the operation — and empty for a
   * platform service actor, whose id is the namespaced `platform:<id>` and owns
   * no rows at all, so the page rendered "No follow-ups" over a workspace with
   * seventy of them.
   *
   * Deliberately not widened for everybody. A manager or administrator opening
   * "Follow-ups" today expects their own queue, and quietly turning it into the
   * company's would change a page people already use. The support and service
   * actors are the case that has no own-queue to show, so they get the whole
   * list with an Owner column; everyone else is untouched.
   */
  const orgWide = ctx.actor.id.startsWith('platform:');
  const where: Record<string, unknown> = {
    tenantId: ctx.tenantId,
    ...(orgWide ? {} : { ownerId: ctx.actor.id }),
    status: { in: ['OPEN', 'IN_PROGRESS', 'RESCHEDULED'] },
    deletedAt: null,
  };

  if (params.due === 'overdue') where.dueAt = { lt: now };
  else if (params.due === 'today') where.dueAt = { gte: now, lte: todayEnd };
  else if (params.due === 'upcoming') where.dueAt = { gt: todayEnd };
  else if (params.due === 'completed') where.status = { in: ['COMPLETED', 'CANCELLED'] };

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

  // Owner names, only when the list spans people. One lookup for the page.
  const owners = orgWide
    ? await prisma.user.findMany({
        where: { tenantId: ctx.tenantId, id: { in: [...new Set(rows.map((row) => row.ownerId))] } },
        select: { id: true, fullName: true },
      })
    : [];
  const ownerById = new Map(owners.map((owner) => [owner.id, owner.fullName]));

  const followUps = rows.map((row) => ({
    ...row,
    lead: row.leadId ? (leadById.get(row.leadId) ?? null) : null,
    // "Removed user" rather than a bare id: an owner whose account is gone still
    // owns rows, and the cuid tells a reader nothing.
    owner: orgWide ? (ownerById.get(row.ownerId) ?? 'Removed user') : null,
  }));

  const configured = await columnsFor(ctx.tenantId, 'FOLLOWUP');
  // The Owner column is off by default — it repeats your own name on a personal
  // list. Inserted after the task title when the list is somebody else's work.
  const columns =
    orgWide && !configured.some((column) => column.key === 'owner')
      ? [configured[0]!, { key: 'owner', label: 'Owner', hideMobile: true }, ...configured.slice(1)]
      : configured;

  return (
    <>
      <ListHeader
        title="Follow-ups"
        count={rows.length}
        capped={rows.length === 100}
        actions={
          <>
            {can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
              <ColumnEditor object="FOLLOWUP" current={columns.map((c) => c.key)} />
            )}
            {can(ctx, 'leads', 'EDIT') && <FollowUpComposer />}
          </>
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
