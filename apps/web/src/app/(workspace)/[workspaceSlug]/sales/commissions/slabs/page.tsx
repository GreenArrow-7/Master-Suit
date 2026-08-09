import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ListHeader from '@/components/workspace/ListHeader';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Commission slabs' };

const pct = (n: { toString(): string } | null) => (n === null ? null : `${Number(n.toString()).toFixed(2)}%`);

const amount = (n: { toString(): string } | null, currency: string) =>
  n === null ? null : `${currency} ${Number(n.toString()).toLocaleString('en-GB')}`;

/**
 * The rules that decide what everybody is paid.
 *
 * This page ships empty on purpose. The spec requires finance to document and
 * sign the slab rules off before any commission is calculated, so the engine
 * carries no rates of its own: until a slab here is signed, `accrueCommission`
 * refuses and nothing accrues. An unsigned slab is shown but is invisible to
 * accrual, which is why the signature column is the first thing on the row.
 */
export default async function CommissionSlabsPage() {
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['commissionslabs', 'VIEW'] });

  const slabs = await prisma.commissionSlab.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ name: 'asc' }, { version: 'desc' }],
    take: 200,
    include: {
      bands: { orderBy: { position: 'asc' } },
      _count: { select: { commissions: true } },
    },
  });

  // projectId is a loose column rather than a relation — a slab may name a
  // project that was since archived, and that must not stop it paying. So the
  // names are looked up separately.
  const projectIds = [...new Set(slabs.map((s) => s.projectId).filter((id): id is string => id !== null))];
  const projects = new Map(
    projectIds.length === 0
      ? []
      : (
          await prisma.project.findMany({
            where: { tenantId: ctx.tenantId, id: { in: projectIds } },
            select: { id: true, name: true },
          })
        ).map((p) => [p.id, p.name] as const),
  );

  const signed = slabs.filter((s) => s.approvedById !== null).length;

  return (
    <>
      <ListHeader
        title="Commission slabs"
        description={
          slabs.length === 0 ? (
            'No rules have been entered.'
          ) : (
            <>
              {signed} signed off · {slabs.length - signed} awaiting finance
            </>
          )
        }
        actions={
          <SalesLink className="lf-btn lf-btn--secondary lf-btn--sm" href="/commissions">
            Back to commissions
          </SalesLink>
        }
      />

      {slabs.length === 0 ? (
        <div className="lf-card">
          <EmptyState
            title="No commission rules yet"
            description="Nothing accrues until finance enters a slab here and someone other than the drafter signs it off. That is deliberate: the engine ships with no rates of its own, so an unsigned workspace pays nothing rather than guessing."
          />
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
          {slabs.map((slab) => (
            <div className="lf-card" key={slab.id}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 'var(--lf-space-3)',
                  marginBottom: 'var(--lf-space-3)',
                }}
              >
                <div>
                  <strong>{slab.name}</strong> <span className="lf-hint">v{slab.version}</span>
                  <div className="lf-hint">
                    {slab.mode === 'PROGRESSIVE' ? 'Progressive' : 'Flat'} ·{' '}
                    {slab.basis === 'PERCENT_OF_SALE'
                      ? 'percent of sale value'
                      : slab.basis === 'PERCENT_OF_AGENCY_FEE'
                        ? 'percent of agency fee'
                        : 'fixed amount'}
                    {slab.projectId && <> · {projects.get(slab.projectId) ?? 'archived project'}</>}
                    {slab.listingType && <> · {slab.listingType}</>}
                    {' · from '}
                    {slab.effectiveFrom.toLocaleDateString('en-GB', { dateStyle: 'medium' })}
                    {slab.effectiveTo && (
                      <> to {slab.effectiveTo.toLocaleDateString('en-GB', { dateStyle: 'medium' })}</>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {/* Unsigned is not a warning, it is the operative state: accrual
                      cannot see this slab at all until finance signs it. */}
                  <Badge
                    value={slab.approvedById ? 'SIGNED OFF' : 'AWAITING FINANCE'}
                    tone={slab.approvedById ? 'viridian' : 'brass'}
                  />
                  <div className="lf-hint">
                    {slab.approvedAt
                      ? `by ${slab.approvedById} on ${slab.approvedAt.toLocaleDateString('en-GB', { dateStyle: 'medium' })}`
                      : 'not used for any calculation'}
                    {slab._count.commissions > 0 && <> · {slab._count.commissions} commissions</>}
                  </div>
                </div>
              </div>

              <table className="lf-grid">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'right' }}>From</th>
                    <th style={{ textAlign: 'right' }}>To</th>
                    <th style={{ textAlign: 'right' }}>Pays</th>
                  </tr>
                </thead>
                <tbody>
                  {slab.bands.map((b) => (
                    <tr key={b.id}>
                      <td style={{ textAlign: 'right' }} className="lf-num">
                        {amount(b.fromAmount, slab.currency)}
                      </td>
                      <td style={{ textAlign: 'right' }} className="lf-num">
                        {/* The top band is open-ended; a ceiling here would cap
                            the biggest sales at nothing. */}
                        {b.toAmount === null ? 'and above' : amount(b.toAmount, slab.currency)}
                      </td>
                      <td style={{ textAlign: 'right' }} className="lf-num">
                        {pct(b.ratePct) ?? amount(b.fixedAmount, slab.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {slab.approvalNote && (
                <p className="lf-hint" style={{ marginTop: 'var(--lf-space-2)' }}>
                  {slab.approvalNote}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
