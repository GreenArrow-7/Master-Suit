import { requirePageAccess } from '@/lib/workspace-page';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import { whoseWork } from '@/components/workspace/WhoseWork';
import FollowUpComposer from './FollowUpComposer';
import { columnsFor } from '@/lib/grid/resolve';
import { can, scopeFor } from '@/lib/security/rbac';
import { leadsInScope, ownerReach, workListScope } from '@/lib/security/record-scope';
import { names } from '@/services/leadership/rollups';
import { workspaceTimezone } from '@/services/hr/attendance';
import { mergeWhere } from '@/lib/api/where';
import {
  FOLLOW_UP_KIND_LABELS,
  OPEN_FOLLOW_UP,
  followUpDueWhere,
  isDayKey,
  isFollowUpKind,
  onDay,
} from '@/lib/leads/followUpDue';
import { boardListWhere } from '@/lib/leads/boardFilter';

export const metadata = { title: 'Follow-ups' };

const TABS = [
  ['All', ''],
  ['Overdue', 'overdue'],
  ['Today', 'today'],
  ['Upcoming', 'upcoming'],
  ['Completed', 'completed'],
] as const;

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{
    due?: string;
    view?: string;
    date?: string;
    kind?: string;
    owner?: string;
    team?: string;
    source?: string;
    project?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['leads', 'VIEW'] });
  const timeZone = await workspaceTimezone(ctx);

  /**
   * Whose follow-ups this page lists: everyone the viewer's `leads` scope
   * covers (a follow-up is read under `leads`), or their own under Mine.
   *
   * It listed the viewer's own alone, under a count line saying "in your
   * scope", so a team lead saw none of the team's; only a platform service
   * actor, whose namespaced id owns no rows, had the whole list, which its
   * ORGANIZATION scope now gives it.
   */
  const view = whoseWork(scopeFor(ctx, 'leads', 'VIEW'), params.view);
  // Due, one day (the board's week strip) and a kind (its Callbacks), on the
  // workspace's clock as the board counts them (lib/leads/followUpDue.ts).
  const where = mergeWhere(
    await workListScope(ctx, 'leads', view.mine),
    params.due === 'completed' ? { status: { in: ['COMPLETED', 'CANCELLED'] } } : OPEN_FOLLOW_UP,
    followUpDueWhere(params, timeZone),
    // The Lead Eagle board's person, team, source and project.
    await boardListWhere(
      ctx,
      { owner: params.owner, team: params.team, source: params.source, project: params.project },
      'followUp',
      timeZone,
    ),
    { deletedAt: null },
  );
  const narrowed = [
    isDayKey(params.date) && `due ${onDay(params.date)}`,
    isFollowUpKind(params.kind) && `${FOLLOW_UP_KIND_LABELS[params.kind].toLowerCase()}s only`,
  ].filter(Boolean);

  const rows = await prisma.followUpTask.findMany({ where, orderBy: { dueAt: 'asc' }, take: 100 });

  // FollowUpTask carries a bare leadId with no relation, so the name is looked up
  // here, for the leads the viewer may open. The column previously showed the
  // first eight characters of the cuid, which identified nothing to the person
  // reading it.
  const leadById = await leadsInScope(
    ctx,
    rows.map((row) => row.leadId),
  );

  // Owner names, only when the list spans people. One lookup for the page.
  const ownerById = view.mine
    ? new Map<string, string>()
    : await names(
        ctx.tenantId,
        rows.map((row) => row.ownerId),
      );

  // Complete and Reschedule only where `follow-ups/{id}` takes them: an owner
  // the viewer's `leads:EDIT` reaches (a Viewer edits nothing).
  const editable = await ownerReach(ctx, 'leads', 'EDIT');

  const followUps = rows.map((row) => ({
    ...row,
    lead: row.leadId ? (leadById.get(row.leadId) ?? null) : null,
    // "Removed user" rather than a bare id: an owner whose account is gone still
    // owns rows, and the cuid tells a reader nothing.
    owner: view.mine ? null : (ownerById.get(row.ownerId) ?? 'Removed user'),
    canAct: editable(row.ownerId),
  }));

  const configured = await columnsFor(ctx.tenantId, 'FOLLOWUP');
  // The Owner column is off by default — it repeats your own name on a personal
  // list. Inserted after the task title when the list is somebody else's work.
  const columns =
    !view.mine && !configured.some((column) => column.key === 'owner')
      ? [configured[0]!, { key: 'owner', label: 'Owner', hideMobile: true }, ...configured.slice(1)]
      : configured;

  // A filter keeps the view, and the view keeps the filter.
  const href = (due: string, mine: boolean) => {
    const query = new URLSearchParams([...(mine ? [['view', 'mine']] : []), ...(due ? [['due', due]] : [])]);
    return query.toString() ? `/follow-ups?${query}` : '/follow-ups';
  };

  return (
    <>
      <ListHeader
        title="Follow-ups"
        description={view.count(rows.length, rows.length === 100, 'follow-up')}
        actions={
          <>
            {can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
              <ColumnEditor object="FOLLOWUP" current={columns.map((c) => c.key)} />
            )}
            {can(ctx, 'leads', 'EDIT') && <FollowUpComposer />}
          </>
        }
      />

      {view.tabs((mine) => href(params.due ?? '', mine))}

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Due filter">
        {TABS.map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={href(key, params.view === 'mine')}
            aria-selected={(params.due ?? '') === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {narrowed.length > 0 && (
        <p className="lf-hint" style={{ margin: '0 0 var(--lf-space-3)' }}>
          Follow-ups {narrowed.join(', ')}.{' '}
          <SalesLink href={href(params.due ?? '', params.view === 'mine')}>Show all</SalesLink>
        </p>
      )}

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
