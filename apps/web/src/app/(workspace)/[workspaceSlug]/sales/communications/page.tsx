import { requirePageAccess } from '@/lib/workspace-page';
import { can } from '@/lib/security/rbac';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import { columnsFor } from '@/lib/grid/resolve';

export const metadata = { title: 'Communications' };

const CHANNELS = [
  ['All', ''],
  ['Email', 'EMAIL'],
  ['SMS', 'SMS'],
  ['WhatsApp', 'WHATSAPP'],
  ['Voice', 'VOICE'],
] as const;

export default async function CommunicationsPage({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['communications', 'VIEW'] });

  if (!can(ctx, 'communications', 'VIEW')) {
    return <EmptyState title="Access denied" description="You do not have permission to view communications." />;
  }

  const channelFilter = params.channel ? { channel: params.channel as any } : {};
  const rows = await prisma.communication.findMany({
    where: { tenantId: ctx.tenantId, ...channelFilter },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      channel: true,
      direction: true,
      toAddress: true,
      subject: true,
      status: true,
      createdAt: true,
    },
  });

  const columns = await columnsFor(ctx.tenantId, 'COMMUNICATION');

  return (
    <>
      <ListHeader
        title="Communications"
        count={rows.length}
        capped={rows.length === 50}
        actions={
          can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
            <ColumnEditor object="COMMUNICATION" current={columns.map((c) => c.key)} />
          )
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }}>
        {CHANNELS.map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/communications?channel=${key}` : '/communications'}
            aria-selected={(params.channel ?? '') === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState title="No communications" description="No messages match this filter." />
        </div>
      ) : (
        <ConfigurableGrid object="COMMUNICATION" columns={columns} rows={rows as any} />
      )}
    </>
  );
}
