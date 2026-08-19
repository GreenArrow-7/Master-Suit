import { requirePageAccess } from '@/lib/workspace-page';
import { mergeWhere } from '@/lib/api/where';
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
import Pager from '@/components/workspace/Pager';
import { resolveColumns, storedColumnsFor } from '@/lib/grid/columns';

export const metadata = { title: 'Leads' };

const PAGE_SIZE = 50;

const FILTERS: Record<string, (now: Date, actorId: string) => Record<string, unknown>> = {
  unassigned: () => ({ ownerId: null }),
  overdue: (now) => ({ nextFollowUpAt: { lt: now } }),
  breached: () => ({ slaState: 'BREACHED' }),
  high_score: () => ({ score: { gte: 70 } }),
  mine: (_now, actorId) => ({ ownerId: actorId }),
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['leads', 'VIEW'] });
  const page = Math.max(1, Number(params.page) || 1);

  const scope = await visibilityWhere(ctx, 'leads', 'VIEW', { includeUnassigned: true });
  const extra = params.filter && FILTERS[params.filter] ? FILTERS[params.filter]!(new Date(), ctx.actor.id) : {};
  const search = params.q
    ? {
        OR: [
          { fullName: { contains: params.q, mode: 'insensitive' as const } },
          { company: { contains: params.q, mode: 'insensitive' as const } },
          { email: { contains: params.q, mode: 'insensitive' as const } },
          { phone: { contains: params.q } },
          { reference: { contains: params.q, mode: 'insensitive' as const } },
        ],
      }
    : {};
  const where = mergeWhere(scope, extra, search);

  const rules = await loadFieldRules(ctx, 'LEAD');

  const [rows, stages, users, taskTypes, setting] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
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

  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  // Masking happens here, in the serialiser, so it covers the grid, exports and
  // every other egress path identically.
  const data = pageRows.map((r) => applyFieldSecurity(ctx, 'LEAD', rules, r, LEAD_SENSITIVE_FIELDS));

  return (
    <>
      <ListHeader
        title="Leads"
        count={pageRows.length}

        capped={hasMore}
        // Adding a lead is what someone came here to do; import, export and
        // column choice are housekeeping and fold behind the disclosure.
        secondaryActions={
          <>
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
          </>
        }
        actions={
          can(ctx, 'leads', 'CREATE') ? (
            <SalesLink className="lf-btn lf-btn--sm" href="/leads/new">
              Add lead
            </SalesLink>
          ) : undefined
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Saved views">
        {[
          ['All leads', ''],
          ['My leads', 'mine'],
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

      <Pager page={page} hasMore={hasMore} basePath="/leads" params={{ filter: params.filter, q: params.q }} />
    </>
  );
}
