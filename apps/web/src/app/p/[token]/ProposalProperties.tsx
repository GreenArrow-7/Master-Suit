'use client';

import { useState } from 'react';
import type { PublicListing } from '@/lib/proposals/publicProposal';

/**
 * The properties, and the two buttons that make this worth sending.
 *
 * A shortlist in WhatsApp gets "ok" back. The value here is the client saying
 * which one — and, when they say no, why, because "too far from the metro" is
 * the next search written by the person who will buy.
 *
 * Answers are changeable. People look again on a bigger screen, and a second
 * opinion is more useful than a first one preserved for its own sake.
 */
export default function ProposalProperties({ token, listings }: { token: string; listings: PublicListing[] }) {
  const [state, setState] = useState<Record<string, { reaction: string | null; comment: string | null }>>(
    Object.fromEntries(listings.map((listing) => [listing.itemId, { reaction: listing.reaction, comment: listing.comment }])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(itemId: string, reaction: string | null, comment: string | null) {
    setBusy(itemId);
    setError(null);
    const previous = state[itemId];
    setState((current) => ({ ...current, [itemId]: { reaction, comment } }));
    try {
      const response = await fetch('/api/v1/public/proposal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, itemId, reaction, comment }),
      });
      if (!response.ok) throw new Error('not saved');
    } catch {
      // Put it back. A tick that stays on screen after it failed to save is
      // worse than no tick — the client believes their agent has been told.
      setState((current) => ({ ...current, [itemId]: previous! }));
      setError('That did not save. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section style={{ display: 'grid', gap: 16 }}>
      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--lf-vermillion)' }}>
          {error}
        </p>
      )}

      {listings.map((listing) => {
        const answered = state[listing.itemId]!;
        return (
          <article key={listing.itemId} className="lf-card" style={{ overflow: 'hidden' }}>
            {listing.images.length > 0 && (
              <div style={{ display: 'flex', gap: 2, overflowX: 'auto', scrollSnapType: 'x mandatory' }}>
                {listing.images.map((src) => (
                  // eslint-disable-next-line @next/next/no-img-element -- signed one-off URLs, not bundled assets
                  <img
                    key={src}
                    src={src}
                    alt=""
                    loading="lazy"
                    style={{
                      height: 220,
                      minWidth: 300,
                      objectFit: 'cover',
                      flex: '0 0 auto',
                      scrollSnapAlign: 'start',
                    }}
                  />
                ))}
              </div>
            )}

            <div style={{ padding: 18, display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <h2 className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>
                  {listing.title}
                </h2>
                {listing.status === 'UNDER_OFFER' && (
                  <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-vermillion)' }}>under offer</span>
                )}
              </div>

              <p style={{ margin: 0, fontSize: 'var(--lf-text-lg)', color: 'var(--agency)' }}>
                {listing.currency} {Number(listing.price).toLocaleString('en-AE')}
                {listing.rentFrequency ? ` / ${listing.rentFrequency.toLowerCase()}` : ''}
              </p>

              <p style={{ margin: 0, color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
                {[
                  listing.community,
                  listing.bedrooms ? `${listing.bedrooms} bed` : null,
                  listing.bathrooms ? `${listing.bathrooms} bath` : null,
                  listing.areaSqft ? `${listing.areaSqft.toLocaleString('en-GB')} sqft` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>

              {listing.note && (
                <p
                  style={{
                    margin: 0,
                    padding: '10px 12px',
                    borderLeft: '3px solid var(--agency-accent)',
                    background: 'var(--lf-surface-2)',
                    fontSize: 'var(--lf-text-sm)',
                  }}
                >
                  {listing.note}
                </p>
              )}

              {listing.description && (
                <p style={{ margin: 0, color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>
                  {listing.description}
                </p>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  className="lf-btn"
                  disabled={busy === listing.itemId}
                  style={
                    answered.reaction === 'INTERESTED'
                      ? { background: 'var(--agency)', borderColor: 'var(--agency)', color: '#fff' }
                      : undefined
                  }
                  onClick={() =>
                    void answer(
                      listing.itemId,
                      answered.reaction === 'INTERESTED' ? null : 'INTERESTED',
                      answered.comment,
                    )
                  }
                >
                  {answered.reaction === 'INTERESTED' ? 'Interested ✓' : 'I like this one'}
                </button>

                <button
                  type="button"
                  className="lf-btn lf-btn--ghost"
                  disabled={busy === listing.itemId}
                  onClick={() =>
                    void answer(
                      listing.itemId,
                      answered.reaction === 'NOT_INTERESTED' ? null : 'NOT_INTERESTED',
                      answered.comment,
                    )
                  }
                >
                  {answered.reaction === 'NOT_INTERESTED' ? 'Not this one ✓' : 'Not for me'}
                </button>

                {listing.permitNumber && (
                  <span
                    style={{ marginLeft: 'auto', fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}
                  >
                    Permit {listing.permitNumber}
                  </span>
                )}
              </div>

              {answered.reaction === 'NOT_INTERESTED' && (
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
                    What was wrong with it? It helps us send you better ones.
                  </span>
                  <input
                    className="lf-input"
                    defaultValue={answered.comment ?? ''}
                    maxLength={1000}
                    placeholder="Too far from the metro"
                    onBlur={(event) => {
                      const comment = event.currentTarget.value.trim() || null;
                      if (comment !== answered.comment) void answer(listing.itemId, 'NOT_INTERESTED', comment);
                    }}
                  />
                </label>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
