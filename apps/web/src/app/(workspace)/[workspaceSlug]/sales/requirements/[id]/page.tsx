import { notFound } from 'next/navigation';
import { Prisma } from '@prisma/client';
import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { assertRecordVisible } from '@/lib/security/visibility';
import { matchesForRequirement } from '@/services/inventory/demand';
import { expireLapsedMandates } from '@/services/inventory/mandates';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import SalesLink from '@/components/workspace/SalesLink';

export const metadata = { title: 'Requirement' };

/**
 * The demand check, from the client side: what can I show this person.
 *
 * Visibility is checked against the requirement, not the listings. The book is
 * shared; the client is not, so an agent cannot read somebody else's buyer by
 * asking what matches them.
 */
export default async function RequirementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['requirements', 'VIEW'] });

  const owned = await prisma.clientRequirement.findFirst({
    where: { id, tenantId: ctx.tenantId, deletedAt: null },
    select: { id: true, tenantId: true, ownerId: true, leadId: true, contactId: true },
  });
  if (!owned) notFound();
  await assertRecordVisible(ctx, 'requirements', owned, prisma, 'VIEW');

  // Lapsed mandates first, so a shortlist never offers stock the agency has
  // lost the right to show.
  await expireLapsedMandates(ctx.tenantId);

  const result = await matchesForRequirement(ctx.tenantId, id, 25);
  if (!result) notFound();
  const { requirement, matches } = result;

  const client = owned.leadId
    ? await prisma.lead.findFirst({
        where: { id: owned.leadId, tenantId: ctx.tenantId },
        select: { id: true, fullName: true },
      })
    : owned.contactId
      ? await prisma.contact.findFirst({
          where: { id: owned.contactId, tenantId: ctx.tenantId },
          select: { id: true, fullName: true },
        })
      : null;

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-5)' }}>
      <header>
        <p className="lf-eyebrow">Requirement</p>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', marginTop: 2 }}>
          {client ? (
            <SalesLink href={owned.leadId ? `/leads/${client.id}` : `/contacts/${client.id}`}>
              {client.fullName}
            </SalesLink>
          ) : (
            'Unknown client'
          )}
        </h1>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <Badge value={requirement.purpose === 'RENT' ? 'RENT' : 'BUY'} />
          <Badge value={requirement.status} />
        </div>
      </header>

      <section className="lf-metric-grid">
        <Metric label="Budget" value={band(requirement.budgetMin, requirement.budgetMax, requirement.currency)} />
        <Metric
          label="Bedrooms"
          value={
            requirement.bedroomsMin == null && requirement.bedroomsMax == null
              ? 'Any'
              : `${requirement.bedroomsMin ?? '—'}${
                  requirement.bedroomsMax && requirement.bedroomsMax !== requirement.bedroomsMin
                    ? `–${requirement.bedroomsMax}`
                    : ''
                }`
          }
        />
        <Metric label="Minimum area" value={requirement.areaMinSqft ? `${requirement.areaMinSqft} sqft` : 'Any'} />
        <Metric
          label="Needs by"
          value={
            requirement.possessionBy
              ? requirement.possessionBy.toLocaleDateString('en-GB', { dateStyle: 'medium' })
              : 'Flexible'
          }
        />
        <Metric
          label="Property types"
          value={requirement.propertyTypes.length ? requirement.propertyTypes.length.toString() : 'Any'}
        />
        <Metric label="Live matches" value={matches.length.toString()} />
      </section>

      {requirement.notes && (
        <section className="lf-card" style={{ padding: 18 }}>
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            Notes
          </h2>
          <p style={{ color: 'var(--lf-ink-2)', margin: 0 }}>{requirement.notes}</p>
        </section>
      )}

      <section className="lf-card" style={{ padding: 18 }}>
        <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
          What we can show them
        </h2>
        <p className="lf-hint" style={{ marginTop: 0 }}>
          Live stock only — a listing whose mandate has lapsed is not offered. Closest to the middle of the stated
          budget first.
        </p>

        {matches.length === 0 ? (
          <EmptyState
            title="Nothing in the book matches yet"
            description="Widen the budget or the locations on this requirement, or take on stock that fits it."
          />
        ) : (
          <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
            <table className="lf-grid">
              <thead>
                <tr>
                  <th>Listing</th>
                  <th>Micromarket</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                  <th style={{ textAlign: 'right' }}>Beds</th>
                  <th style={{ textAlign: 'right' }}>Area</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <SalesLink href={`/listings/${m.id}`}>{m.title}</SalesLink>
                    </td>
                    <td>{m.micromarket ? `${m.micromarket.name}, ${m.micromarket.city}` : '—'}</td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {m.currency} {Number(m.price).toLocaleString('en-AE')}
                      {m.rentFrequency ? ` /${m.rentFrequency.toLowerCase().slice(0, 2)}` : ''}
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {m.bedrooms ?? '—'}
                    </td>
                    <td style={{ textAlign: 'right' }} className="lf-num">
                      {m.areaSqft ? m.areaSqft.toLocaleString('en-GB') : '—'}
                    </td>
                    <td>
                      <Badge value={m.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="lf-metric-card">
      <div className="lf-eyebrow">{label}</div>
      <div className="lf-metric-card__value">{value}</div>
    </article>
  );
}

const band = (min: Prisma.Decimal | null, max: Prisma.Decimal | null, currency: string) => {
  if (!min && !max) return 'Open';
  const fmt = (d: Prisma.Decimal) => Number(d).toLocaleString('en-AE');
  if (min && max) return `${currency} ${fmt(min)}–${fmt(max)}`;
  return `${currency} ${min ? `${fmt(min)}+` : `up to ${fmt(max!)}`}`;
};
