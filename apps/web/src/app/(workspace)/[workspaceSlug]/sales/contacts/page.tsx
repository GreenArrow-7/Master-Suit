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

export const metadata = { title: 'Contacts' };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['contacts', 'VIEW'] });

  const scope = await visibilityWhere(ctx, 'contacts', 'VIEW', { includeUnassigned: true });
  const search = params.q ? { fullName: { contains: params.q, mode: 'insensitive' as const } } : {};
  const where = { ...scope, ...search };

  const rules = await loadFieldRules(ctx, 'CONTACT');

  const rows = await prisma.contact.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: {
      id: true,
      reference: true,
      fullName: true,
      jobTitle: true,
      email: true,
      phone: true,
      updatedAt: true,
      account: { select: { id: true, name: true } },
      owner: { select: { fullName: true } },
    },
  });

  const data = rows.map((r) => applyFieldSecurity(ctx, 'CONTACT', rules, r));

  const columns = await columnsFor(ctx.tenantId, 'CONTACT');

  return (
    <>
      <ListHeader
        title="Contacts"
        description={
          <>
            {rows.length === 50 ? 'First 50 records' : `${rows.length} record${rows.length === 1 ? '' : 's'}`} in your
            scope
          </>
        }
        actions={
          <>
            {can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
              <ColumnEditor object="CONTACT" current={columns.map((c) => c.key)} />
            )}
            {can(ctx, 'contacts', 'CREATE') && (
              <SalesLink className="lf-btn lf-btn--sm" href="/contacts/new">
                Add contact
              </SalesLink>
            )}
          </>
        }
      />

      {data.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="No contacts yet"
            description="Contacts are the people at an account you talk to."
            actionLabel={can(ctx, 'contacts', 'CREATE') ? 'Add contact' : undefined}
            actionHref="/contacts/new"
          />
        </div>
      ) : (
        <ConfigurableGrid object="CONTACT" columns={columns} rows={data as any} />
      )}
    </>
  );
}
