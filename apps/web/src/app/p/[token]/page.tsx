import { notFound } from 'next/navigation';
import { AppError } from '@/lib/errors';
import { loadProposal, recordView } from '@/lib/proposals/publicProposal';
import ProposalProperties from './ProposalProperties';

export const metadata = { title: 'Your shortlist' };

/**
 * The page a client opens from their WhatsApp message.
 *
 * Outside every route group on purpose: no workspace layout, no sidebar, no
 * session. The only thing identifying the visitor is the signed token in the
 * URL, and the only thing they can do with it is say what they think of the
 * properties on it.
 *
 * Branded as the agency, not as us. A brokerage sending this to their client is
 * putting their own name on it, and a product logo on that page would be us
 * advertising to somebody else's customer.
 *
 * Server-rendered from the same loader the public API uses, so the page and the
 * route cannot drift into disagreeing about what is safe to disclose.
 */
export default async function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let proposal;
  try {
    proposal = await loadProposal(decodeURIComponent(token));
  } catch (err) {
    // A bad, withdrawn or expired link is a 404 page, not an error page: there
    // is nothing wrong on our side and nothing for the visitor to retry.
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  }

  await recordView(proposal);

  const { agency, agent } = proposal;

  return (
    <main
      style={{
        minHeight: '100dvh',
        background: 'var(--lf-surface-2)',
        // The agency's own colours, from their workspace settings, scoped to
        // this page rather than set globally.
        ['--agency' as string]: agency.primaryColor,
        ['--agency-accent' as string]: agency.accentColor,
      }}
    >
      <header style={{ borderTop: `4px solid var(--agency)`, background: 'var(--lf-surface)' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px', display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {agency.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a tenant's own logo URL, not a bundled asset
              <img src={agency.logoUrl} alt={agency.name} style={{ height: 36, width: 'auto' }} />
            ) : (
              <strong style={{ fontSize: 'var(--lf-text-lg)', color: 'var(--agency)' }}>{agency.name}</strong>
            )}
            {agency.reraOrn && (
              <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>ORN {agency.reraOrn}</span>
            )}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 64px', display: 'grid', gap: 20 }}>
        <section>
          <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', margin: 0 }}>
            {proposal.title}
          </h1>
          {proposal.message && (
            <p style={{ color: 'var(--lf-ink-2)', marginTop: 10, whiteSpace: 'pre-wrap' }}>{proposal.message}</p>
          )}
          {agent && (
            <p style={{ color: 'var(--lf-ink-3)', marginTop: 10, fontSize: 'var(--lf-text-sm)' }}>
              Put together by {agent.name}
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
                  <a href={`mailto:${agent.email}`} style={{ color: 'var(--agency)' }}>
                    {agent.email}
                  </a>
                </>
              )}
            </p>
          )}
        </section>

        {proposal.listings.length === 0 ? (
          <section className="lf-card" style={{ padding: 24 }}>
            <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
              Nothing to show just now
            </h2>
            <p style={{ color: 'var(--lf-ink-2)', margin: 0 }}>
              The properties on this shortlist are no longer available.{' '}
              {agent ? `Speak to ${agent.name} and they will send you more.` : 'Speak to your agent for more.'}
            </p>
          </section>
        ) : (
          <ProposalProperties token={token} listings={proposal.listings} />
        )}

        <footer style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)', textAlign: 'center' }}>
          Sent by {agency.name}
          {agency.reraOrn ? ` · ORN ${agency.reraOrn}` : ''}. Prices and availability are subject to change.
        </footer>
      </div>
    </main>
  );
}
