import { requirePageAccess } from '@/lib/workspace-page';
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

export const metadata = { title: 'Accounts' };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['accounts', 'VIEW'] });

  const scope = await visibilityWhere(ctx, 'accounts', 'VIEW', { includeUnassigned: true });
  const search = params.q ? { name: { contains: params.q, mode: 'insensitive' as const } } : {};
  const where = { ...scope, ...search };

  const rules = await loadFieldRules(ctx, 'ACCOUNT');

  const rows = await prisma.account.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: {
      id: true,
      reference: true,
      name: true,
      industry: true,
      mainPhone: true,
      mainEmail: true,
      status: true,
      customerTier: true,
      updatedAt: true,
      owner: { select: { fullName: true } },
    },
  });

  const data = rows.map((r) => applyFieldSecurity(ctx, 'ACCOUNT', rules, r));

  const columns = await columnsFor(ctx.tenantId, 'ACCOUNT');

  return (
    <>
      <ListHeader
        title="Accounts"
        description={
          <>
            {rows.length === 50 ? 'First 50 records' : `${rows.length} record${rows.length === 1 ? '' : 's'}`} in your
            scope
          </>
        }
        actions={
          <>
            <form method="get" role="search">
              <input
                name="q"
                type="search"
                className="lf-input"
                defaultValue={params.q ?? ''}
                placeholder="Search accounts"
                aria-label="Search accounts"
                style={{ height: 28, width: 180, fontSize: 'var(--lf-text-xs)' }}
              />
            </form>
            {can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
              <ColumnEditor object="ACCOUNT" current={columns.map((c) => c.key)} />
            )}
            {can(ctx, 'accounts', 'CREATE') && (
              <SalesLink className="lf-btn lf-btn--sm" href="/accounts/new">
                Add account
              </SalesLink>
            )}
          </>
        }
      />

      {data.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="No accounts yet"
            description="Accounts group contacts and opportunities under a company."
            actionLabel={can(ctx, 'accounts', 'CREATE') ? 'Add account' : undefined}
            actionHref="/accounts/new"
          />
        </div>
      ) : (
        <ConfigurableGrid object="ACCOUNT" columns={columns} rows={data as any} />
      )}
    </>
  );
}
