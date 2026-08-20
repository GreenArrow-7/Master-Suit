import { requirePageAccess } from '@/lib/workspace-page';
import { mergeWhere } from '@/lib/api/where';
import { prisma } from '@/lib/db';
import { visibilityWhere } from '@/lib/security/visibility';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import SalesLink from '@/components/workspace/SalesLink';
import { Prisma } from '@prisma/client';

export const metadata = { title: 'Requirements' };

/**
 * What clients are looking for — the demand side of the book.
 *
 * Owner-scoped, unlike listings. Stock is shared and demand is not: a
 * requirement is somebody's client, so `visibilityWhere` gives an agent their
 * own and a manager their subtree, exactly as it does for leads.
 */
export default async function RequirementsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['requirements', 'VIEW'] });

  const scope = await visibilityWhere(ctx, 'requirements', 'VIEW');
  const status = ['OPEN', 'MATCHED', 'FULFILLED', 'CLOSED'].includes(params.status ?? '') ? params.status : undefined;

  const rows = await prisma.clientRequirement.findMany({
    where: mergeWhere(scope, { deletedAt: null }, status ? { status: status as never } : null),
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });

  // A requirement carries no name of its own; it hangs off a lead or a contact.
  const leadIds = rows.map((r) => r.leadId).filter((v): v is string => Boolean(v));
  const contactIds = rows.map((r) => r.contactId).filter((v): v is string => Boolean(v));
  const [leads, contacts] = await Promise.all([
    leadIds.length
      ? prisma.lead.findMany({
          where: { tenantId: ctx.tenantId, id: { in: leadIds } },
          select: { id: true, fullName: true },
        })
      : [],
    contactIds.length
      ? prisma.contact.findMany({
          where: { tenantId: ctx.tenantId, id: { in: contactIds } },
          select: { id: true, fullName: true },
        })
      : [],
  ]);
  const name = new Map<string, string>([
    ...leads.map((l) => [l.id, l.fullName] as const),
    ...contacts.map((c) => [c.id, c.fullName] as const),
  ]);

  return (
    <>
      <ListHeader title="Requirements" description={`${rows.length} requirement${rows.length === 1 ? '' : 's'}`} />

      <nav className="lf-tabs" style={{ marginBottom: 'var(--lf-space-4)' }} aria-label="Status filter">
        {[
          ['All', ''],
          ['Open', 'OPEN'],
          ['Matched', 'MATCHED'],
          ['Fulfilled', 'FULFILLED'],
          ['Closed', 'CLOSED'],
        ].map(([label, key]) => (
          <SalesLink
            key={label}
            className="lf-tab"
            href={key ? `/requirements?status=${key}` : '/requirements'}
            aria-selected={(params.status ?? '') === key}
            role="tab"
          >
            {label}
          </SalesLink>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="No requirements captured"
            description="Record what a client is looking for and the demand check will match it against live stock."
          />
        </div>
      ) : (
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th>Client</th>
                <th>Looking to</th>
                <th style={{ textAlign: 'right' }}>Budget</th>
                <th style={{ textAlign: 'right' }}>Beds</th>
                <th>Needs by</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>{name.get(r.leadId ?? r.contactId ?? '') ?? 'Unknown'}</td>
                  <td>{r.purpose === 'RENT' ? 'Rent' : 'Buy'}</td>
                  <td style={{ textAlign: 'right' }} className="lf-num">
                    {band(r.budgetMin, r.budgetMax, r.currency)}
                  </td>
                  <td style={{ textAlign: 'right' }} className="lf-num">
                    {r.bedroomsMin ?? '—'}
                    {r.bedroomsMax && r.bedroomsMax !== r.bedroomsMin ? `–${r.bedroomsMax}` : ''}
                  </td>
                  <td>
                    {r.possessionBy
                      ? r.possessionBy.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
                      : 'Flexible'}
                  </td>
                  <td>
                    <Badge value={r.status} />
                  </td>
                  <td>
                    <SalesLink className="lf-btn lf-btn--secondary lf-btn--sm" href={`/requirements/${r.id}`}>
                      Matches
                    </SalesLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const band = (min: Prisma.Decimal | null, max: Prisma.Decimal | null, currency: string) => {
  if (!min && !max) return 'Open';
  const fmt = (d: Prisma.Decimal) => Number(d).toLocaleString('en-AE');
  if (min && max) return `${currency} ${fmt(min)}–${fmt(max)}`;
  return `${currency} ${min ? `${fmt(min)}+` : `up to ${fmt(max!)}`}`;
};
