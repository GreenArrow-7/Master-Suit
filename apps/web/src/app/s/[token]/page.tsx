import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { clientIp } from '@/lib/auth/session';
import { AppError } from '@/lib/errors';
import { consume, limits } from '@/lib/security/ratelimit';
import { loadShare, recordShareView } from '@/services/leads/leadShares';

export const metadata = { title: 'Shared with you', robots: { index: false, follow: false } };

const money = (amount: string | number, currency: string) => `${currency} ${Number(amount).toLocaleString('en-GB')}`;
const RENT: Readonly<Record<string, string>> = { MONTHLY: 'month', QUARTERLY: 'quarter', YEARLY: 'year' };
const sentence = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * A project or a listing an agent shared with a lead (M4-30), opened from
 * their WhatsApp message: `/s/{token}`. Outside every route group, as the
 * shortlist page `/p/{token}` is: no session, the agency's name and colours,
 * and only what an advert would carry (services/leads/leadShares.ts). Opening
 * it is logged on the lead. A bad, revoked or lapsed link is a 404; past the
 * public forms' rate the page says so and logs nothing.
 */
export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const head = await headers();
  const ip = clientIp(new Request('http://share.local/', { headers: head })) ?? 'unknown';
  try {
    await consume(limits.publicShare(ip));
  } catch (err) {
    if (err instanceof AppError && err.status === 429) {
      return (
        <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
          <p className="lf-card" style={{ padding: 'var(--lf-space-5)', margin: 0 }}>
            Too many requests. Please try again in a minute.
          </p>
        </main>
      );
    }
    throw err;
  }

  let share;
  try {
    share = await loadShare(decodeURIComponent(token));
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  }
  await recordShareView(share, `${ip}|${head.get('user-agent') ?? ''}`);

  const { agency, agent, listing, project } = share;
  const facts = listing
    ? [
        listing.bedrooms != null && `${listing.bedrooms} bed`,
        listing.bathrooms != null && `${listing.bathrooms} bath`,
        listing.areaSqft != null && `${listing.areaSqft.toLocaleString('en-GB')} sq ft`,
        sentence(listing.propertyType),
        listing.status === 'UNDER_OFFER' && 'Under offer',
      ].filter((fact): fact is string => Boolean(fact))
    : [];

  return (
    <main
      style={{
        minHeight: '100dvh',
        background: 'var(--lf-surface-2)',
        ['--agency' as string]: agency.primaryColor,
      }}
    >
      <header style={{ borderTop: '4px solid var(--agency)', background: 'var(--lf-surface)' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px', display: 'flex', gap: 12 }}>
          {agency.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a tenant's own logo URL, not a bundled asset
            <img src={agency.logoUrl} alt={agency.name} style={{ height: 36, width: 'auto' }} />
          ) : (
            <strong style={{ fontSize: 'var(--lf-text-lg)', color: 'var(--agency)' }}>{agency.name}</strong>
          )}
          {agency.reraOrn && (
            <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)', alignSelf: 'center' }}>
              {`ORN ${agency.reraOrn}`}
            </span>
          )}
        </div>
      </header>

      <article
        style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px 64px', display: 'grid', gap: 16, minWidth: 0 }}
      >
        {listing && (
          <>
            <div>
              <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: 0, overflowWrap: 'anywhere' }}>
                {listing.title}
              </h1>
              {listing.community && <p style={{ color: 'var(--lf-ink-2)', margin: '6px 0 0' }}>{listing.community}</p>}
            </div>
            <p style={{ fontSize: 'var(--lf-text-xl)', fontWeight: 600, margin: 0 }}>
              {listing.rentFrequency
                ? `${money(listing.price, listing.currency)} / ${RENT[listing.rentFrequency] ?? 'period'}`
                : money(listing.price, listing.currency)}
            </p>
            <ul className="lf-chips" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {facts.map((fact) => (
                <li key={fact} className="lf-chip">
                  {fact}
                </li>
              ))}
            </ul>
            {listing.images.length > 0 && (
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                {listing.images.map((src, index) => (
                  // eslint-disable-next-line @next/next/no-img-element -- served by the signed /li route, not bundled
                  <img
                    key={src}
                    src={src}
                    alt={`${listing.title}, photo ${index + 1}`}
                    loading="lazy"
                    style={{ width: '100%', height: 'auto', borderRadius: 8, background: 'var(--lf-surface)' }}
                  />
                ))}
              </div>
            )}
            {listing.description && (
              <p style={{ whiteSpace: 'pre-wrap', margin: 0, color: 'var(--lf-ink-2)' }}>{listing.description}</p>
            )}
            {listing.permitNumber && (
              <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)', margin: 0 }}>
                {`Permit ${listing.permitNumber}`}
              </p>
            )}
          </>
        )}

        {project && (
          <>
            <div>
              <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: 0, overflowWrap: 'anywhere' }}>
                {project.name}
              </h1>
              <p style={{ color: 'var(--lf-ink-2)', margin: '6px 0 0' }}>
                {[project.developer && `by ${project.developer}`, project.community].filter(Boolean).join(' · ')}
              </p>
            </div>
            {project.fromPrice && (
              <p style={{ fontSize: 'var(--lf-text-xl)', fontWeight: 600, margin: 0 }}>{`From ${project.fromPrice}`}</p>
            )}
            <ul className="lf-chips" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {[
                [project.possession, project.handover && `handover ${project.handover}`].filter(Boolean).join(', '),
                ...project.unitTypes,
              ]
                .filter(Boolean)
                .map((fact) => (
                  <li key={fact} className="lf-chip">
                    {fact}
                  </li>
                ))}
            </ul>
            {project.highlights.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--lf-ink-2)' }}>
                {project.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            )}
            {project.description && (
              <p style={{ whiteSpace: 'pre-wrap', margin: 0, color: 'var(--lf-ink-2)' }}>{project.description}</p>
            )}
            {project.reraNumber && (
              <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)', margin: 0 }}>
                {`RERA ${project.reraNumber}`}
              </p>
            )}
          </>
        )}

        {agent && (
          <p style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)', margin: 0 }}>
            {`Shared by ${agent.name}`}
            {agent.phone && (
              <>
                {' · '}
                <a href={`tel:${agent.phone}`} style={{ color: 'var(--agency)' }}>
                  {agent.phone}
                </a>
              </>
            )}
            {agent.email && (
              <>
                {' · '}
                <a href={`mailto:${agent.email}`} style={{ color: 'var(--agency)', overflowWrap: 'anywhere' }}>
                  {agent.email}
                </a>
              </>
            )}
          </p>
        )}
        <footer style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)' }}>
          {`Shared by ${agency.name}. Prices and availability are subject to change.`}
        </footer>
      </article>
    </main>
  );
}
