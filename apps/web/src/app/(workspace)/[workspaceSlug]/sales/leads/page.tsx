import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import { LEAD_SENSITIVE_FIELDS } from '@/services/leads/createLead';
import LeadGrid from './LeadGrid';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import LeadImport from './LeadImport';
import { resolveColumns, storedColumnsFor } from '@/lib/grid/columns';

export const metadata = { title: 'Leads' };

const FILTERS: Record<string, (now: Date) => Record<string, unknown>> = {
  unassigned: () => ({ ownerId: null }),
  overdue: (now) => ({ nextFollowUpAt: { lt: now } }),
  breached: () => ({ slaState: 'BREACHED' }),
  high_score: () => ({ score: { gte: 70 } }),
};

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['leads', 'VIEW'] });

  const scope = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
  const extra = params.filter && FILTERS[params.filter] ? FILTERS[params.filter]!(new Date()) : {};
  const search = params.q ? { fullName: { contains: params.q, mode: 'insensitive' as const } } : {};
  const where = { ...scope, ...extra, ...search };

  const rules = await loadFieldRules(ctx, 'LEAD');

  const [rows, stages, users, taskTypes, setting] = await Promise.all([
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
    prisma.leadStage.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { position: 'asc' },
      select: { id: true, key: true, name: true },
    }),
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
    prisma.organizationSetting.findUnique({
      where: { tenantId: ctx.tenantId },
      select: { gridColumns: true },
    }),
  ]);

  const columns = resolveColumns('LEAD', storedColumnsFor(setting?.gridColumns, 'LEAD'));

  // Masking happens here, in the serialiser, so it covers the grid, exports and
  // every other egress path identically.
  const data = rows.map((r) => applyFieldSecurity(ctx, 'LEAD', rules, r, LEAD_SENSITIVE_FIELDS));

  return (
    <>
      <ListHeader
        title="Leads"
        count={rows.length}

        capped={rows.length === 50}
        actions={
          <span style={{ position: 'relative', display: 'flex', gap: 'var(--lf-space-2)' }}>
            {can(ctx, 'leads', 'IMPORT') && <LeadImport />}
            {can(ctx, 'leads', 'EXPORT') && (
              <a
                className="lf-btn lf-btn--secondary lf-btn--sm"
                href={`/api/v1/leads/export?${new URLSearchParams({ ...(params.filter ? { filter: params.filter } : {}), ...(params.q ? { q: params.q } : {}) })}`}
              >
                Export
              </a>
            )}
            {can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
              <ColumnEditor object="LEAD" current={columns.map((column) => column.key)} />
            )}
            {can(ctx, 'leads', 'CREATE') && (
              <SalesLink className="lf-btn lf-btn--sm" href="/leads/new">
                Add lead
              </SalesLink>
            )}
          </span>
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Saved views">
        {[
          ['All leads', ''],
          ['Unassigned', 'unassigned'],
          ['Overdue follow-up', 'overdue'],
          ['SLA breached', 'breached'],
          ['High score', 'high_score'],
        ].map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/leads?filter=${key}` : '/leads'}
            aria-selected={(params.filter ?? '') === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {data.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="Nothing matches this view"
            description="Adjust the filter, or add a lead to start building this list."
            actionLabel={can(ctx, 'leads', 'CREATE') ? 'Add lead' : undefined}
            actionHref="/leads/new"
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
    </>
  );
}
