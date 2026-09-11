import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import {
  emptyFollowUpLabel,
  obligationAccess,
  obligationWhere,
  scopedNextFollowUp,
} from '@/services/leads/nextFollowUp';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { compileFilterTree, referencedFields, type FilterNode } from '@/lib/api/filterTree';
import { mergeWhere } from '@/lib/api/where';
import { can } from '@/lib/security/rbac';
import { resolveColumns, storedColumnsFor } from '@/lib/grid/columns';
import { prisma } from '@/lib/db';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import LeadGrid from '../leads/LeadGrid';
import EmptyState from '@/components/ui/EmptyState';
import ViewSidebar from './ViewSidebar';
import ListHeader from '@/components/workspace/ListHeader';

export const metadata = { title: 'Smart Views' };

/**
 * Is every leaf of this tree the old "overdue follow-up" comparison?
 *
 * That is the shape the removed system view shipped with, so every saved view
 * cloned from it looks like this. Its meaning is unchanged by the withdrawal —
 * "overdue" is still a question with an answer — so it is honoured, scoped to
 * the viewer rather than to every owner as it used to be.
 */
function isLegacyOverdueTree(node: FilterNode): boolean {
  if ('op' in node) return node.children.length > 0 && node.children.every(isLegacyOverdueTree);
  return node.field === 'nextFollowUpAt' && node.cmp === 'relative' && node.value === 'overdue';
}

interface SystemView {
  key: string;
  name: string;
  icon: string;
  /**
   * Absent for views whose predicate depends on the viewer.
   *
   * A `FilterNode` is a comparison on a Lead column, and the obligation views
   * cannot be expressed as one: what counts as overdue depends on which
   * obligations the person looking is allowed to see.
   */
  filter?: FilterNode;
}

const SYSTEM_VIEWS: SystemView[] = [
  { key: 'all', name: 'All Leads', icon: '◇', filter: { op: 'AND', children: [] } },
  { key: 'my-leads', name: 'My Leads', icon: '◈', filter: { field: 'owner.id', cmp: 'eq', value: '$currentUser' } },
  { key: 'unassigned', name: 'Unassigned', icon: '○', filter: { field: 'owner.id', cmp: 'is_null' } },
  { key: 'today', name: "Today's Leads", icon: '◇', filter: { field: 'createdAt', cmp: 'relative', value: 'today' } },
  {
    key: 'yesterday',
    name: "Yesterday's Leads",
    icon: '◇',
    filter: { field: 'createdAt', cmp: 'relative', value: 'yesterday' },
  },
  {
    key: 'this-week',
    name: 'This Week',
    icon: '◇',
    filter: { field: 'createdAt', cmp: 'relative', value: 'this_week' },
  },
  {
    key: 'this-month',
    name: 'This Month',
    icon: '◇',
    filter: { field: 'createdAt', cmp: 'relative', value: 'this_month' },
  },
  // No `filter` here: "overdue" is a question about obligations, and which of
  // them count depends on who is asking. Built below from the same predicate
  // the leads list uses rather than from a comparison on the stored column,
  // which would answer for every owner regardless of the viewer's reach.
  { key: 'overdue', name: 'Overdue Follow-up', icon: '!' },
  { key: 'no-next-action', name: 'No Next Action', icon: '○' },
  { key: 'breached', name: 'SLA Breached', icon: '!', filter: { field: 'slaState', cmp: 'eq', value: 'BREACHED' } },
  { key: 'at-risk', name: 'SLA At Risk', icon: '△', filter: { field: 'slaState', cmp: 'eq', value: 'AT_RISK' } },
  { key: 'hot', name: 'Hot Leads', icon: '★', filter: { field: 'score', cmp: 'gte', value: 70 } },
  {
    key: 'cold',
    name: 'No Activity (30d)',
    icon: '○',
    filter: { field: 'lastActivityAt', cmp: 'relative', value: 'last_30_days' },
  },
];

export default async function SmartViewsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; id?: string; q?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['smartviews', 'VIEW'] });

  const savedViews = await prisma.smartView.findMany({
    where: {
      tenantId: ctx.tenantId,
      objectType: 'LEAD',
      deletedAt: null,
      OR: [
        { ownerId: ctx.actor.id },
        { visibility: 'ORGANIZATION' },
        { sharedTeamIds: { hasSome: [...ctx.actor.teamIds] } },
        { sharedRoleIds: { has: ctx.actor.roleId } },
      ],
    },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, filterTree: true, sortSpec: true, visibility: true, ownerId: true },
  });

  const activeSystemKey = params.view ?? (params.id ? null : 'all');
  const activeSystem = activeSystemKey ? SYSTEM_VIEWS.find((v) => v.key === activeSystemKey) : null;
  const activeSaved = params.id ? savedViews.find((v) => v.id === params.id) : null;

  // The two obligation views, scoped to the viewer. `access` also drives the
  // dates rendered into the grid below, so the rows and their dates agree.
  const access = await obligationAccess(ctx, 'scope');
  const now = new Date();

  /**
   * A saved view built on the withdrawn `nextFollowUpAt` filter.
   *
   * `null` means the view does not mention it. Otherwise it is either
   * translated — the shape the old system view used is exactly "overdue", and
   * that meaning survives the withdrawal — or it is something this cannot
   * safely reinterpret, and the screen says so.
   *
   * The behaviour being replaced was a bare `catch` that showed every lead. A
   * filter that silently stops filtering is the worst of the three options: the
   * list looks like an answer to the question the view's name asks, and is not.
   */
  let compatibility: 'translated' | 'unsupported' | null = null;

  let filterWhere: Record<string, unknown> = {};
  if (activeSystem?.filter) {
    filterWhere = compileFilterTree('LEAD', activeSystem.filter, ctx);
  } else if (activeSaved?.filterTree && typeof activeSaved.filterTree === 'object') {
    const tree = activeSaved.filterTree as FilterNode;
    if (referencedFields(tree).includes('nextFollowUpAt')) {
      if (isLegacyOverdueTree(tree)) {
        filterWhere = obligationWhere(access, 'overdue', now) as Record<string, unknown>;
        compatibility = 'translated';
      } else {
        compatibility = 'unsupported';
      }
    } else {
      try {
        filterWhere = compileFilterTree('LEAD', tree, ctx);
      } catch {
        /* bad filter — show all */
      }
    }
  }
  if (activeSystemKey === 'overdue') {
    filterWhere = obligationWhere(access, 'overdue', now) as Record<string, unknown>;
  } else if (activeSystemKey === 'no-next-action') {
    filterWhere = {
      // Only live leads: a won or lost lead with nothing scheduled is finished,
      // not neglected, and listing it buries the ones that are.
      AND: [obligationWhere(access, 'unscheduled', now), { stage: { is: { category: 'OPEN' } } }],
    } as Record<string, unknown>;
  }

  // "No Activity (30d)" needs inversion: leads whose lastActivityAt is older than 30 days OR null
  if (activeSystemKey === 'cold') {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    filterWhere = { OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: d } }] };
  }

  const scope = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
  const search = params.q ? { fullName: { contains: params.q, mode: 'insensitive' as const } } : {};
  // Spreading these would have discarded the visibility clause outright: the
  // "cold" view's filter *is* an `OR`, and so is `scope`'s ownership
  // restriction. See lib/api/where.ts — this was the one place the leak needed
  // no crafted request at all, only the button.
  const where = mergeWhere(scope, filterWhere, search);

  const rules = await loadFieldRules(ctx, 'LEAD');

  const [rows, stages, counts, users, taskTypes, setting] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: {
        id: true,
        reference: true,
        fullName: true,
        email: true,
        phone: true,
        company: true,
        score: true,
        grade: true,
        priority: true,
        slaState: true,
        nextFollowUpAt: true,
        updatedAt: true,
        ownerId: true,
        stage: { select: { key: true, name: true, color: true } },
        owner: { select: { fullName: true } },
      },
    }),
    // `id` is required: LeadGrid's stage picker renders `value={stage.id}`, so
    // omitting it produced options with no value rather than only a type error.
    prisma.leadStage.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { position: 'asc' },
      select: { id: true, key: true, name: true },
    }),
    prisma.lead.count({ where }),
    // LeadGrid needs the same context here as on the leads list, or its stage,
    // owner and follow-up controls render with nothing to choose from.
    prisma.user.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE', deletedAt: null },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true },
    }),
    prisma.taskType.findMany({
      where: { tenantId: ctx.tenantId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.organizationSetting.findUnique({ where: { tenantId: ctx.tenantId }, select: { gridColumns: true } }),
  ]);
  const columns = resolveColumns('LEAD', storedColumnsFor(setting?.gridColumns, 'LEAD'));

  // The grid shows the viewer's own obligations, never the stored aggregate —
  // same derivation as the leads list, so the same lead reads the same way on
  // both screens.
  const due = await scopedNextFollowUp(
    ctx.tenantId,
    rows.map((r) => r.id),
    access,
  );
  const data = rows
    .map((r) => ({ ...r, nextFollowUpAt: due.get(r.id) ?? null }))
    .map((r) => applyFieldSecurity(ctx, 'LEAD', rules, r, LEAD_SENSITIVE_FIELDS));

  const activeName = activeSystem?.name ?? activeSaved?.name ?? 'All Leads';

  return (
    <div className="lf-smartviews" style={{ display: 'flex', gap: 'var(--lf-space-5)', minHeight: 0 }}>
      <ViewSidebar
        systemViews={SYSTEM_VIEWS.map((v) => ({ key: v.key, name: v.name, icon: v.icon }))}
        savedViews={savedViews.map((v) => ({ id: v.id, name: v.name, mine: v.ownerId === ctx.actor.id }))}
        activeSystemKey={activeSystemKey}
        activeSavedId={params.id ?? null}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <ListHeader
          title={activeName}
          description={counts === 50 ? '50+ leads' : `${counts} lead${counts === 1 ? '' : 's'}`}
        />

        {compatibility === 'translated' && (
          <div className="lf-alert" style={{ marginBottom: 'var(--lf-space-3)' }} role="status">
            This saved view filtered on the next follow-up date. It now shows leads with an <strong>overdue</strong>{' '}
            task or follow-up <strong>that you are allowed to see</strong>, which is what it was asking for.
          </div>
        )}
        {compatibility === 'unsupported' && (
          <div className="lf-alert" style={{ marginBottom: 'var(--lf-space-3)' }} role="alert">
            <strong>This view is not filtering.</strong> It was built on the next follow-up date, which was withdrawn as
            a filter because the stored value covers every owner&rsquo;s obligations rather than yours. Every lead you
            can see is listed below. Use the <strong>Overdue Follow-up</strong> or <strong>No Next Action</strong> view,
            or rebuild this one without that condition.
          </div>
        )}

        {data.length === 0 ? (
          <div className="lf-card">
            <EmptyState
              title="No leads in this view"
              description="Try a different view or adjust your search."
              icon="◇"
            />
          </div>
        ) : (
          <LeadGrid
            rows={data as any}
            columns={columns}
            stages={stages}
            users={users}
            taskTypes={taskTypes}
            canAssign={can(ctx, 'leads', 'ASSIGN')}
            canEdit={can(ctx, 'leads', 'EDIT')}
            emptyLabel={emptyFollowUpLabel(access, 'scope')}
          />
        )}
      </div>
    </div>
  );
}
