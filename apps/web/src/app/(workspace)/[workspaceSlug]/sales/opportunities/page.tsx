import { requirePageAccess } from '@/lib/workspace-page';
import { mergeWhere } from '@/lib/api/where';
import { visibilityWhere } from '@/lib/security/visibility';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import { columnsFor } from '@/lib/grid/resolve';

export const metadata = { title: 'Opportunities' };

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['opportunities', 'VIEW'] });

  const scope = await visibilityWhere(ctx, 'opportunities', 'VIEW', { includeUnassigned: true });
  const search = params.q ? { name: { contains: params.q, mode: 'insensitive' as const } } : {};
  const where = mergeWhere(scope, search);

  const rules = await loadFieldRules(ctx, 'OPPORTUNITY');

  const rows = await prisma.opportunity.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      amount: true,
      currency: true,
      probability: true,
      expectedCloseDate: true,
      actualCloseDate: true,
      updatedAt: true,
      stage: { select: { key: true, name: true, color: true } },
      account: { select: { name: true } },
      owner: { select: { fullName: true } },
    },
  });

  const data = rows.map((r) => applyFieldSecurity(ctx, 'OPPORTUNITY', rules, r));

  // The header figure covers the whole filtered set, not just the 50 rows on screen.
  const openPipeline = await prisma.opportunity.aggregate({
    where: { ...where, status: 'OPEN' },
    _sum: { amount: true },
  });
  const pipelineTotal = Number(openPipeline._sum.amount ?? 0);

  const columns = await columnsFor(ctx.tenantId, 'OPPORTUNITY');

  return (
    <>
      <ListHeader
        title="Opportunities"
        description={
          <>
            {rows.length === 50 ? 'First 50 records' : `${rows.length} record${rows.length === 1 ? '' : 's'}`} in your
            scope
            {pipelineTotal > 0 &&
              ` · ${rows[0]?.currency ?? 'AED'} ${pipelineTotal.toLocaleString('en-AE')} open pipeline`}
          </>
        }
        secondaryActions={
          can(ctx, 'settings', 'MANAGE_CONFIGURATION') ? (
            <ColumnEditor object="OPPORTUNITY" current={columns.map((c) => c.key)} />
          ) : undefined
        }
        actions={
          can(ctx, 'opportunities', 'CREATE') ? (
            <SalesLink className="lf-btn lf-btn--sm" href="/opportunities/new">
              Add opportunity
            </SalesLink>
          ) : undefined
        }
      />

      {/* The search box lived in the header's action cluster, 180px wide at
          28px tall, beside two buttons. It is a toolbar control, like the
          Leads list's, so it lives in the toolbar. */}
      <div className="lf-toolbar">
        <form className="lf-toolbar__search" method="get" role="search">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3" />
          </svg>
          <input
            name="q"
            type="search"
            className="lf-input"
            defaultValue={params.q ?? ''}
            placeholder="Search opportunities by name"
            aria-label="Search opportunities"
          />
        </form>
        {params.q && (
          <SalesLink className="lf-btn lf-btn--ghost lf-btn--sm" href="/opportunities">
            Clear all
          </SalesLink>
        )}
      </div>

      {data.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="No opportunities yet"
            description="Convert a qualified lead, or start one directly against an account."
            actionLabel={can(ctx, 'opportunities', 'CREATE') ? 'Add opportunity' : undefined}
            actionHref="/opportunities/new"
          />
        </div>
      ) : (
        <ConfigurableGrid object="OPPORTUNITY" columns={columns} rows={data as any} />
      )}
    </>
  );
}
