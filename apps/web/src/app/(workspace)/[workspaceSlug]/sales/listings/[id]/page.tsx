import { notFound } from 'next/navigation';
import { Prisma } from '@prisma/client';
import { requirePageAccess } from '@/lib/workspace-page';
import { prisma } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import { maskOwner } from '@/lib/inventory/listings';
import { expireLapsedMandates } from '@/services/inventory/mandates';
import { requirementsWanting } from '@/services/inventory/demand';
import Badge from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
import MandatePanel from './MandatePanel';

export const metadata = { title: 'Listing' };

/**
 * One property, and the three questions asked about it: what is it, may we
 * market it, and who wanted it.
 *
 * The demand matches are computed here rather than fetched from /demand — the
 * page is already server-rendered, and a round trip to our own API to fill a
 * section below the fold is a hop for nothing.
 */
export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['listings', 'VIEW'] });

  await expireLapsedMandates(ctx.tenantId);

  const listing = await prisma.listing.findFirst({
    where: { id, tenantId: ctx.tenantId, deletedAt: null },
    include: {
      propertyOwner: { select: { id: true, fullName: true, phone: true, email: true, whatsappNumber: true } },
      micromarket: { select: { id: true, name: true, city: true } },
      project: { select: { id: true, name: true } },
      unit: { select: { id: true, unitNumber: true, tower: true, floor: true, status: true } },
      media: { orderBy: [{ kind: 'asc' }, { position: 'asc' }] },
      mandates: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  });
  if (!listing) notFound();

  const [amenities, demand] = await Promise.all([
    listing.amenityKeys.length
      ? prisma.amenity.findMany({
          where: { tenantId: ctx.tenantId, key: { in: listing.amenityKeys } },
          select: { key: true, label: true },
          orderBy: { position: 'asc' },
        })
      : [],
    // Only for people allowed to see other agents' clients.
    can(ctx, 'requirements', 'VIEW') ? requirementsWanting(ctx.tenantId, listing.id, 10) : null,
  ]);

  const owner = maskOwner(ctx, listing.propertyOwner);
  const canSeeContact = can(ctx, 'listings', 'VIEW_SENSITIVE_FIELDS');
  const gallery = listing.media.filter((m) => m.kind === 'IMAGE');
  const documents = listing.media.filter(
    (m) => m.kind === 'BROCHURE' || m.kind === 'CREATIVE' || m.kind === 'FLOOR_PLAN',
  );
  const embeds = listing.media.filter((m) => m.kind === 'VIDEO' || m.kind === 'VR_TOUR');

  const price = `${listing.currency} ${Number(listing.price).toLocaleString('en-AE')}${
    listing.rentFrequency ? ` per ${listing.rentFrequency.toLowerCase().replace('ly', '')}` : ''
  }`;

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-5)' }}>
      <header>
        <p className="lf-eyebrow">
          {listing.reference}
          {listing.micromarket ? ` · ${listing.micromarket.name}, ${listing.micromarket.city}` : ''}
          {listing.project ? ` · ${listing.project.name}` : ''}
        </p>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', marginTop: 2 }}>
          {listing.title}
        </h1>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <Badge value={listing.listingType} tone={listing.listingType === 'RENT' ? 'brass' : 'viridian'} />
          <Badge value={listing.status} />
          <Badge value={listing.propertyType} tone="slate" />
          {listing.mandateType && <Badge value={listing.mandateType} tone="viridian" />}
        </div>
      </header>

      <section className="lf-metric-grid">
        <Metric label={listing.listingType === 'RENT' ? 'Rent' : 'Asking price'} value={price} />
        <Metric label="Bedrooms" value={listing.bedrooms?.toString() ?? '—'} />
        <Metric label="Bathrooms" value={listing.bathrooms?.toString() ?? '—'} />
        <Metric label="Area" value={listing.areaSqft ? `${listing.areaSqft.toLocaleString('en-GB')} sqft` : '—'} />
        <Metric label="Rate / sqft" value={rate(listing.price, listing.areaSqft, listing.currency)} />
        <Metric
          label="Available"
          value={
            listing.availableFrom ? listing.availableFrom.toLocaleDateString('en-GB', { dateStyle: 'medium' }) : 'Now'
          }
        />
      </section>

      {listing.description && (
        <section className="lf-card" style={{ padding: 18 }}>
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            About
          </h2>
          <p style={{ color: 'var(--lf-ink-2)', margin: 0 }}>{listing.description}</p>
          {listing.highlights.length > 0 && (
            <ul style={{ marginTop: 12, paddingLeft: 18, color: 'var(--lf-ink-2)' }}>
              {listing.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="lf-card" style={{ padding: 18 }}>
        <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
          Property owner
        </h2>
        {owner ? (
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', margin: 0 }}>
            <Row label="Name" value={owner.fullName} />
            <Row label="Phone" value={owner.phone} />
            <Row label="Email" value={owner.email} />
            <Row label="WhatsApp" value={owner.whatsappNumber} />
          </dl>
        ) : (
          <p className="lf-hint" style={{ margin: 0 }}>
            No owner recorded.
          </p>
        )}
        {!canSeeContact && (
          <p className="lf-hint" style={{ marginTop: 10 }}>
            Contact details are hidden. They are shown to roles holding the sensitive-field permission on listings.
          </p>
        )}
      </section>

      <MandatePanel
        listingId={listing.id}
        canEdit={can(ctx, 'listings', 'EDIT')}
        daysLeft={
          listing.mandateExpires ? Math.ceil((listing.mandateExpires.getTime() - Date.now()) / 86_400_000) : null
        }
        mandates={listing.mandates.map((m) => ({
          id: m.id,
          type: m.type,
          status: m.status,
          startsAt: m.startsAt.toISOString(),
          expiresAt: m.expiresAt.toISOString(),
          commissionPct: m.commissionPct ? m.commissionPct.toString() : null,
          terminationNote: m.terminationNote,
        }))}
      />

      {amenities.length > 0 && (
        <section className="lf-card" style={{ padding: 18 }}>
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            Amenities
          </h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {amenities.map((a) => (
              <Badge key={a.key} value={a.label} tone="slate" />
            ))}
          </div>
        </section>
      )}

      {(gallery.length > 0 || documents.length > 0 || embeds.length > 0) && (
        <section className="lf-card" style={{ padding: 18 }}>
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            Media
          </h2>
          {gallery.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 8,
                marginBottom: 16,
              }}
            >
              {gallery.map((m) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={m.id}
                  src={`/api/v1/listings/${listing.id}/media/${m.id}/file`}
                  alt={m.title ?? listing.title}
                  loading="lazy"
                  style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 6 }}
                />
              ))}
            </div>
          )}
          {documents.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', display: 'grid', gap: 6 }}>
              {documents.map((m) => (
                <li key={m.id}>
                  <a
                    className="lf-btn lf-btn--secondary lf-btn--sm"
                    href={`/api/v1/listings/${listing.id}/media/${m.id}/file`}
                  >
                    {title(m.kind)}: {m.title ?? 'Untitled'}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {embeds.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
              {embeds.map((m) => (
                <li key={m.id}>
                  <a href={m.externalUrl ?? '#'} target="_blank" rel="noreferrer noopener">
                    {title(m.kind)}: {m.title ?? m.externalUrl}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* The demand check, from the stock side: open requirements this property
          answers. Hidden entirely from roles without `requirements:VIEW`,
          because the answer is a list of other people's clients. */}
      {demand && (
        <section className="lf-card" style={{ padding: 18 }}>
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            Who wanted this
          </h2>
          {demand.requirements.length === 0 ? (
            <p className="lf-hint" style={{ margin: 0 }}>
              No open requirement matches this property yet.
            </p>
          ) : (
            <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
              <table className="lf-grid">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th style={{ textAlign: 'right' }}>Budget</th>
                    <th style={{ textAlign: 'right' }}>Beds</th>
                    <th>Needs by</th>
                  </tr>
                </thead>
                <tbody>
                  {demand.requirements.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.leadId ? (
                          <SalesLink href={`/leads/${r.leadId}`}>Lead</SalesLink>
                        ) : r.contactId ? (
                          <SalesLink href={`/contacts/${r.contactId}`}>Contact</SalesLink>
                        ) : (
                          '—'
                        )}
                      </td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
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

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <>
      <dt style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value || '—'}</dd>
    </>
  );
}

const title = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');

const rate = (price: Prisma.Decimal, area: number | null, currency: string) =>
  area && area > 0 ? `${currency} ${Number(price.div(area).toDecimalPlaces(0)).toLocaleString('en-AE')}` : '—';

const band = (min: Prisma.Decimal | null, max: Prisma.Decimal | null, currency: string) => {
  if (!min && !max) return 'Open';
  const fmt = (d: Prisma.Decimal) => Number(d).toLocaleString('en-AE');
  if (min && max) return `${currency} ${fmt(min)}–${fmt(max)}`;
  return `${currency} ${min ? `${fmt(min)}+` : `up to ${fmt(max!)}`}`;
};
