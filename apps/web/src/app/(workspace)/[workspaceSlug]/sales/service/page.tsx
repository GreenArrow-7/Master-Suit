import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import { columnsFor } from '@/lib/grid/resolve';

export const metadata = { title: 'Service' };

const TABS = [
  ['All', ''],
  ['Open', 'OPEN'],
  ['Escalated', 'ESCALATED'],
  ['Resolved', 'RESOLVED'],
] as const;

export default async function ServicePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['tickets', 'VIEW'] });

  if (!can(ctx, 'tickets', 'VIEW')) {
    return <EmptyState title="Access denied" description="You do not have permission to view tickets." />;
  }

  const scope = await visibilityWhere(ctx, 'tickets', 'VIEW', { ownerField: 'agentId' });
  const statusFilter = params.tab ? { status: params.tab as any } : {};

  const rows = await prisma.ticket.findMany({
    where: { ...scope, ...statusFilter },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      number: true,
      subject: true,
      priority: true,
      status: true,
      channel: true,
      slaState: true,
      createdAt: true,
      agent: { select: { fullName: true } },
    },
  });

  const columns = await columnsFor(ctx.tenantId, 'TICKET');

  return (
    <>
      <ListHeader
        title="Service"
        count={rows.length}
        capped={rows.length === 50}
        actions={
          can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
            <ColumnEditor object="TICKET" current={columns.map((c) => c.key)} />
          )
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }}>
        {TABS.map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/service?tab=${key}` : '/service'}
            aria-selected={(params.tab ?? '') === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState title="No tickets" description="No tickets match this view." />
        </div>
      ) : (
        <ConfigurableGrid object="TICKET" columns={columns} rows={rows as any} />
      )}
    </>
  );
}
