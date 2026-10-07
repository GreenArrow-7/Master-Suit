import type { DataStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { LEAD_MODULES } from '@/lib/security/entitlements';
import { can } from '@/lib/security/rbac';
import { requirePageAccess } from '@/lib/workspace-page';
import ListHeader from '@/components/workspace/ListHeader';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';
import { coldDataScope } from '@/services/leads/coldData';
import LeadImport from '../leads/LeadImport';
import { STATUS_LABEL } from '@/lib/leads/coldDataStatus';
import { ListAssign, RecordActions } from './ColdDataActions';

export const metadata = { title: 'Cold data' };

/**
 * Cold data (Lead Eagle plan, gap 5): raw lists worked by phone before anyone
 * is a lead. Each list shows how far it got; the records still to work come
 * first, and converted ones step aside (filter by Converted to see them).
 */
export default async function ColdDataPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string; status?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: LEAD_MODULES, permission: ['leads', 'VIEW'] });
  const scope = coldDataScope(ctx);
  const status = params.status && params.status in STATUS_LABEL ? (params.status as DataStatus) : undefined;
  const canAssign = can(ctx, 'leads', 'ASSIGN');

  const [counts, records, agents] = await Promise.all([
    prisma.dataRecord.groupBy({ by: ['batch', 'status'], where: scope, _count: { _all: true } }),
    prisma.dataRecord.findMany({
      where: {
        ...scope,
        ...(params.list && { batch: params.list }),
        status: status ?? { not: 'CONVERTED' },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      take: 200,
      include: { owner: { select: { fullName: true } } },
    }),
    canAssign
      ? prisma.user.findMany({
          where: { tenantId: ctx.tenantId, status: 'ACTIVE', deletedAt: null },
          select: { id: true, fullName: true },
          orderBy: { fullName: 'asc' },
        })
      : [],
  ]);

  const lists = new Map<string, Partial<Record<DataStatus, number>>>();
  for (const row of counts) lists.set(row.batch, { ...lists.get(row.batch), [row.status]: row._count._all });
  const href = (next: { list?: string; status?: string }) => {
    const query = new URLSearchParams(
      Object.entries({ ...params, ...next }).filter((entry): entry is [string, string] => !!entry[1]),
    );
    return `/cold-data${query.size ? `?${query}` : ''}`;
  };

  return (
    <>
      <ListHeader
        title="Cold data"
        description="Raw lists worked by phone. A contact becomes a lead when there is something there."
        actions={can(ctx, 'leads', 'IMPORT') && <LeadImport endpoint="/api/v1/cold-data/import" noun="contact" />}
      />

      {lists.size === 0 ? (
        <EmptyState
          title="No lists yet"
          description="Import a spreadsheet of contacts: an expo's cards, a bought list."
        />
      ) : (
        <>
          <div className="lf-table-wrap">
            <table className="lf-table">
              <thead>
                <tr>
                  <th>List</th>
                  <th>Contacts</th>
                  <th>Still to work</th>
                  <th>Interested</th>
                  <th>Converted</th>
                  {canAssign && <th>Assign to</th>}
                </tr>
              </thead>
              <tbody>
                {[...lists].map(([list, byStatus]) => {
                  const total = Object.values(byStatus).reduce((sum, n) => sum + (n ?? 0), 0);
                  const converted = byStatus.CONVERTED ?? 0;
                  return (
                    <tr key={list} aria-current={params.list === list ? 'true' : undefined}>
                      <td>
                        <SalesLink href={href({ list })}>{list}</SalesLink>
                      </td>
                      <td>{total}</td>
                      <td>{(byStatus.NOT_CONTACTED ?? 0) + (byStatus.NOT_REACHABLE ?? 0)}</td>
                      <td>{byStatus.INTERESTED ?? 0}</td>
                      <td>
                        {converted} ({Math.round((converted / total) * 100)}%)
                      </td>
                      {canAssign && (
                        <td>
                          <ListAssign list={list} agents={agents} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <nav
            aria-label="Filter contacts"
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: 'var(--lf-space-4) 0 var(--lf-space-2)' }}
          >
            {params.list && <SalesLink href={href({ list: '' })}>All lists</SalesLink>}
            {Object.entries(STATUS_LABEL).map(([key, label]) => (
              <SalesLink
                key={key}
                href={href({ status: status === key ? '' : key })}
                aria-current={status === key || undefined}
              >
                {label}
              </SalesLink>
            ))}
          </nav>

          <div className="lf-table-wrap">
            <table className="lf-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Company</th>
                  <th>List</th>
                  <th>Agent</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>{record.fullName}</td>
                    <td>{record.phone ? <a href={`tel:${record.phone}`}>{record.phone}</a> : '—'}</td>
                    <td>{record.company ?? '—'}</td>
                    <td>{record.batch}</td>
                    <td>{record.owner?.fullName ?? 'Unassigned'}</td>
                    <td>
                      <RecordActions
                        id={record.id}
                        status={record.status}
                        convertedLeadId={record.convertedLeadId}
                        canEdit={can(ctx, 'leads', 'EDIT')}
                        canConvert={can(ctx, 'leads', 'CREATE')}
                      />
                    </td>
                  </tr>
                ))}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={6}>Nothing here.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
