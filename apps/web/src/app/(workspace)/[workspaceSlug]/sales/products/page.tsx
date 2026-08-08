import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import { columnsFor } from '@/lib/grid/resolve';
import { can } from '@/lib/security/rbac';

export const metadata = { title: 'Products' };

const CATEGORIES = ['Off-plan', 'Ready', 'Commercial', 'Mortgage', 'Services'] as const;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['products', 'VIEW'] });

  const catFilter = params.category && CATEGORIES.includes(params.category as any) ? { category: params.category } : {};

  const rows = await prisma.product.findMany({
    where: { tenantId: ctx.tenantId, ...catFilter },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    select: { id: true, code: true, name: true, category: true, unitPrice: true, status: true },
    take: 100,
  });

  const columns = await columnsFor(ctx.tenantId, 'PRODUCT');

  return (
    <>
      <ListHeader
        title="Products"
        description={
          <>
            {rows.length} product{rows.length === 1 ? '' : 's'}
          </>
        }

        actions={
          can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
            <ColumnEditor object="PRODUCT" current={columns.map((c) => c.key)} />
          )
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Category filter">
        {[['All', ''] as const, ...CATEGORIES.map((c) => [c, c] as const)].map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/products?category=${key}` : '/products'}
            aria-selected={(params.category ?? '') === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="No products found"
            description="Adjust the category filter or add a product to get started."
          />
        </div>
      ) : (
        <ConfigurableGrid object="PRODUCT" columns={columns} rows={rows as any} />
      )}
    </>
  );
}
