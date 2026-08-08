import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { compileFilterTree, type FilterNode } from '@/lib/api/filterTree';
import { can } from '@/lib/security/rbac';
import { resolveColumns, storedColumnsFor } from '@/lib/grid/columns';
import { prisma } from '@/lib/db';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import LeadGrid from '../leads/LeadGrid';
import EmptyState from '@/components/ui/EmptyState';
import ViewSidebar from './ViewSidebar';
import ListHeader from '@/components/workspace/ListHeader';

export const metadata = { title: 'Smart Views' };

interface SystemView {
  key: string;
  name: string;
  icon: string;
  filter: FilterNode;
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
  {
    key: 'overdue',
    name: 'Overdue Follow-up',
    icon: '!',
    filter: { field: 'nextFollowUpAt', cmp: 'relative', value: 'overdue' },
  },
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

  let filterWhere: Record<string, unknown> = {};
  if (activeSystem) {
    filterWhere = compileFilterTree('LEAD', activeSystem.filter, ctx);
  } else if (activeSaved?.filterTree && typeof activeSaved.filterTree === 'object') {
    try {
      filterWhere = compileFilterTree('LEAD', activeSaved.filterTree as FilterNode, ctx);
    } catch {
      /* bad filter — show all */
    }
  }

  // "No Activity (30d)" needs inversion: leads whose lastActivityAt is older than 30 days OR null
  if (activeSystemKey === 'cold') {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    filterWhere = { OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: d } }] };
  }

  const scope = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
  const search = params.q ? { fullName: { contains: params.q, mode: 'insensitive' as const } } : {};
  const where = { ...scope, ...filterWhere, ...search };

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

  const data = rows.map((r) => applyFieldSecurity(ctx, 'LEAD', rules, r, LEAD_SENSITIVE_FIELDS));

  const activeName = activeSystem?.name ?? activeSaved?.name ?? 'All Leads';

  return (
    <div style={{ display: 'flex', gap: 'var(--lf-space-5)', minHeight: 0 }}>
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
          />
        )}
      </div>
    </div>
  );
}
