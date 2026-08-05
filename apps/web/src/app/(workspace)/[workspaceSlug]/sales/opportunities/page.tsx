import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { visibilityWhere } from '@/lib/security/visibility';
import { loadFieldRules, applyFieldSecurity } from '@/lib/security/fieldSecurity';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import { columnsFor } from '@/lib/grid/resolve';

export const metadata = { title: 'Opportunities' };

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());

  const scope = await visibilityWhere(ctx, 'opportunities', 'VIEW', { includeUnassigned: true });
  const search = params.q ? { name: { contains: params.q, mode: 'insensitive' as const } } : {};
  const where = { ...scope, ...search };

  const rules = await loadFieldRules(ctx, 'OPPORTUNITY');

  const rows = await prisma.opportunity.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: {
      id: true, reference: true, name: true, status: true, amount: true, currency: true,
      probability: true, expectedCloseDate: true, updatedAt: true,
      stage: { select: { key: true, name: true, color: true } },
      account: { select: { name: true } },
      owner: { select: { fullName: true } },
    },
  });

  const data = rows.map((r) => applyFieldSecurity(ctx, 'OPPORTUNITY', rules, r));
  const pipelineTotal = rows.filter((r) => r.status === 'OPEN').reduce((sum, r) => sum + Number(r.amount), 0);

  const columns = await columnsFor(ctx.tenantId, 'OPPORTUNITY');

  return (
    <>
            <ListHeader
        title="Opportunities"
        description={<>{rows.length === 50 ? 'First 50 records' : `${rows.length} record${rows.length === 1 ? '' : 's'}`} in your scope
            {pipelineTotal > 0 && ` · ${rows[0]?.currency ?? 'AED'} ${pipelineTotal.toLocaleString()} open pipeline`}</>}
        actions={<>
          {can(ctx, 'settings', 'MANAGE_CONFIGURATION') && <ColumnEditor object="OPPORTUNITY" current={columns.map((c) => c.key)} />}
{can(ctx, 'opportunities', 'CREATE') && <SalesLink className="lf-btn lf-btn--sm" href="/opportunities/new">Add opportunity</SalesLink>}
        </>}
      />

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

function formatDate(value?: string | Date | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
