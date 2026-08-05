import { headers } from 'next/headers';
import { ulid } from 'ulid';
import { resolveCtx } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import ListHeader from '@/components/workspace/ListHeader';
import ConfigurableGrid from '@/components/workspace/ConfigurableGrid';
import ColumnEditor from '@/components/workspace/ColumnEditor';
import { columnsFor } from '@/lib/grid/resolve';
import { can } from '@/lib/security/rbac';

export const metadata = { title: 'Field Sales' };

const TABS = [['All', ''], ['Checked In', 'checked-in'], ['Completed', 'completed'], ['Planned', 'planned']] as const;

export default async function FieldSalesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams;
  const ctx = await resolveCtx(new Request('http://internal/', { headers: await headers() }), ulid());

  const now = new Date();
  let extraWhere: Record<string, unknown> = {};
  if (params.tab === 'checked-in') extraWhere = { checkInAt: { not: { equals: null } }, checkOutAt: null };
  else if (params.tab === 'completed') extraWhere = { checkOutAt: { not: { equals: null } } };
  else if (params.tab === 'planned') extraWhere = { checkInAt: null, plannedAt: { gte: now } };

  const rows = await prisma.fieldVisit.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null, ...extraWhere },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, plannedAt: true, checkInAt: true, checkOutAt: true,
      outcome: true, distanceMeters: true, geofenceOk: true, notes: true,
      userId: true, leadId: true,
    },
  });

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const leadIds = [...new Set(rows.filter((r) => r.leadId).map((r) => r.leadId!))];

  // Both lookups must carry tenantId: the tenant guard rejects an unscoped read, so
  // without it this page threw before it could render, and a cross-tenant id in the
  // list would otherwise have resolved to another workspace's name.
  const [users, leads] = await Promise.all([
    userIds.length > 0
      ? prisma.user.findMany({
          where: { tenantId: ctx.tenantId, id: { in: userIds } },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
    leadIds.length > 0
      ? prisma.lead.findMany({
          where: { tenantId: ctx.tenantId, id: { in: leadIds } },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
  ]);

  const userMap = Object.fromEntries(users.map((u) => [u.id, u.fullName]));
  const leadMap = Object.fromEntries(leads.map((l) => [l.id, l.fullName]));

  function visitStatus(r: (typeof rows)[0]) {
    if (r.checkOutAt) return 'completed';
    if (r.checkInAt) return 'checked-in';
    return 'planned';
  }

  // The grid renders from a shared cell map, so the two lookup tables and the two
  // derived values are folded into the row here rather than inside the JSX.
  const visits = rows.map((r) => ({
    ...r,
    rep: userMap[r.userId] ?? '—',
    lead: r.leadId && leadMap[r.leadId] ? { id: r.leadId, fullName: leadMap[r.leadId] } : null,
    status: visitStatus(r),
    durationSecs: r.checkInAt && r.checkOutAt
      ? Math.round((new Date(r.checkOutAt).getTime() - new Date(r.checkInAt).getTime()) / 1000)
      : null,
  }));

  const columns = await columnsFor(ctx.tenantId, 'FIELDVISIT');

  return (
    <>
            <ListHeader
        title="Field Sales"
        description={<>{rows.length} visit{rows.length === 1 ? '' : 's'}</>}
      
        actions={can(ctx, 'settings', 'MANAGE_CONFIGURATION') && <ColumnEditor object="FIELDVISIT" current={columns.map((c) => c.key)} />}
      />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Visit filter">
        {TABS.map(([label, key]) => (
          <SalesLink key={label} className="lf-tab" href={key ? `/field-sales?tab=${key}` : '/field-sales'}
             aria-selected={(params.tab ?? '') === key} role="tab">
            {label}
          </SalesLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState title="No field visits yet" description="Field visits with check-in/check-out tracking will appear here." />
        </div>
      ) : (
        <ConfigurableGrid object="FIELDVISIT" columns={columns} rows={visits as any} />
      )}
    </>
  );
}
