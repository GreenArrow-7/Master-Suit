import { requirePageAccess } from '@/lib/workspace-page';
import { visibilityWhere } from '@/lib/security/visibility';
import { prisma } from '@/lib/db';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import { columnsFor } from '@/lib/grid/resolve';
import { can } from '@/lib/security/rbac';

export const metadata = { title: 'Activities' };

const TYPE_TABS = [
  ['All', ''],
  ['Calls', 'CALL'],
  ['Meetings', 'MEETING'],
  ['Emails', 'EMAIL'],
  ['Field Visits', 'FIELD_VISIT'],
] as const;

export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['activities', 'VIEW'] });
  const scope = await visibilityWhere(ctx, 'activities', 'VIEW', { ownerField: 'ownerId' });

  const typeFilter = params.tab ? { type: { key: params.tab } } : {};

  const rows = await prisma.activity.findMany({
    where: { ...scope, deletedAt: null, ...typeFilter },
    orderBy: { occurredAt: 'desc' },
    take: 50,
    select: {
      id: true,
      occurredAt: true,
      outcome: true,
      durationSecs: true,
      type: { select: { key: true, name: true } },
      lead: { select: { id: true, fullName: true } },
      owner: { select: { fullName: true } },
    },
  });

  const columns = await columnsFor(ctx.tenantId, 'ACTIVITY');

  return (
    <>
      <ListHeader
        title="Activities"
        description={
          <>
            {rows.length === 50 ? 'First 50 records' : `${rows.length} record${rows.length === 1 ? '' : 's'}`} in your
            scope
          </>
        }

        actions={
          can(ctx, 'settings', 'MANAGE_CONFIGURATION') && (
            <ColumnEditor object="ACTIVITY" current={columns.map((c) => c.key)} />
          )
        }
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Activity type">
        {TYPE_TABS.map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/activities?tab=${key}` : '/activities'}
            aria-selected={(params.tab ?? '') === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState title="No activities yet" description="Log a call, meeting, or email to see it here." />
        </div>
      ) : (
        <ConfigurableGrid object="ACTIVITY" columns={columns} rows={rows as any} />
      )}
    </>
  );
}
