import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/workspace-page';
import { AppError } from '@/lib/errors';
import { proposalDetail } from '@/services/proposals/proposals';
import Badge from '@/components/ui/Badge';
import SalesLink from '@/components/workspace/SalesLink';
import ProposalActions from './ProposalActions';

export const metadata = { title: 'Proposal' };

/**
 * One shortlist: the link to send, who opened it, and what they said.
 *
 * The answers are the reason to open this page. An agent who knows the client
 * ticked the second and third and wrote "too far from the metro" on the first
 * has their next call and their next search, both written by the buyer.
 */
export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAccess({ module: 'SALES', permission: ['requirements', 'VIEW'] });

  let proposal;
  try {
    proposal = await proposalDetail(ctx, id);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  }

  const liked = proposal.items.filter((item) => item.reaction === 'INTERESTED').length;
  const rejected = proposal.items.filter((item) => item.reaction === 'NOT_INTERESTED').length;

  return (
    <div style={{ display: 'grid', gap: 'var(--lf-space-5)' }}>
      <header>
        <p className="lf-eyebrow">Proposal</p>
        <h1 className="lf-h1" style={{ fontSize: 'var(--lf-text-2xl)', marginTop: 2 }}>
          {proposal.title}
        </h1>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge value={proposal.status} />
          {proposal.owner && <span style={{ color: 'var(--lf-ink-3)' }}>{proposal.owner.fullName}</span>}
          {proposal.leadId && <SalesLink href={`/leads/${proposal.leadId}`}>Open the lead</SalesLink>}
          {proposal.contactId && <SalesLink href={`/contacts/${proposal.contactId}`}>Open the contact</SalesLink>}
        </div>
      </header>

      <ProposalActions
        id={proposal.id}
        status={proposal.status}
        url={proposal.url}
        expiresAt={proposal.expiresAt?.toISOString() ?? null}
      />

      <section className="lf-metric-grid">
        <Metric label="Properties" value={proposal.items.length.toString()} />
        <Metric label="Liked" value={liked > 0 ? liked.toString() : '—'} />
        <Metric label="Ruled out" value={rejected > 0 ? rejected.toString() : '—'} />
        <Metric
          label="Opened"
          value={
            proposal.status !== 'SENT'
              ? '—'
              : proposal.firstViewedAt
                ? `${proposal.viewCount} ${proposal.viewCount === 1 ? 'time' : 'times'}`
                : 'not yet'
          }
        />
        <Metric
          label="First opened"
          value={proposal.firstViewedAt ? proposal.firstViewedAt.toLocaleString('en-GB') : '—'}
        />
        <Metric
          label="Last opened"
          value={proposal.lastViewedAt ? proposal.lastViewedAt.toLocaleString('en-GB') : '—'}
        />
      </section>

      {proposal.message && (
        <section className="lf-card" style={{ padding: 18 }}>
          <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
            What they were told
          </h2>
          <p style={{ color: 'var(--lf-ink-2)', margin: 0, whiteSpace: 'pre-wrap' }}>{proposal.message}</p>
        </section>
      )}

      <section className="lf-card" style={{ padding: 18 }}>
        <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', marginTop: 0 }}>
          What they said
        </h2>
        <div className="lf-grid-wrap" style={{ overflowX: 'auto' }}>
          <table className="lf-grid">
            <thead>
              <tr>
                <th>Property</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th>Their answer</th>
                <th>In their words</th>
              </tr>
            </thead>
            <tbody>
              {proposal.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <SalesLink href={`/listings/${item.listing.id}`}>{item.listing.title}</SalesLink>
                    <span style={{ display: 'block', fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
                      {item.listing.reference}
                      {item.listing.micromarket ? ` · ${item.listing.micromarket.name}` : ''}
                      {item.listing.bedrooms ? ` · ${item.listing.bedrooms} bed` : ''}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }} className="lf-num">
                    {item.listing.currency} {Number(item.listing.price).toLocaleString('en-AE')}
                  </td>
                  <td>
                    {item.reaction === 'INTERESTED' ? (
                      <Badge tone="viridian">Interested</Badge>
                    ) : item.reaction === 'NOT_INTERESTED' ? (
                      <Badge tone="wine">Not this one</Badge>
                    ) : (
                      <span style={{ color: 'var(--lf-ink-3)' }}>no answer</span>
                    )}
                    {item.reactedAt && (
                      <span style={{ display: 'block', fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
                        {item.reactedAt.toLocaleDateString('en-GB')}
                      </span>
                    )}
                  </td>
                  <td style={{ maxWidth: '24rem' }}>
                    {item.comment ? (
                      <span style={{ color: 'var(--lf-ink-2)' }}>“{item.comment}”</span>
                    ) : (
                      <span style={{ color: 'var(--lf-ink-3)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
