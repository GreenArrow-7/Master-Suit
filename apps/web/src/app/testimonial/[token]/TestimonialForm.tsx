'use client';

import { useState } from 'react';

/**
 * A rating, a box, and one tick.
 *
 * The tick is the point of the form. Publishing somebody's words under their
 * name needs their say-so, and asking for it here — in their own words, at the
 * moment they write them — is the only place it can honestly be collected. It
 * is unticked by default, and the server refuses to publish without it.
 */
export default function TestimonialForm({ token }: { token: string }) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [consent, setConsent] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/public/testimonial', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          rating,
          body,
          consentToPublish: consent,
          displayName: displayName.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? 'That could not be saved. Try again shortly.');
        return;
      }
      setDone(true);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <p>Thank you — that has been sent to your agent.</p>;
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--lf-space-4)' }}>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ marginBottom: 'var(--lf-space-2)' }}>Your rating</legend>
        <div role="radiogroup" aria-label="Rating out of five" style={{ display: 'flex', gap: 'var(--lf-space-2)' }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              type="button"
              key={n}
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} out of 5`}
              onClick={() => setRating(n)}
              className={rating >= n ? 'lf-btn lf-btn--sm' : 'lf-btn lf-btn--secondary lf-btn--sm'}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>

      <label style={{ display: 'grid', gap: 'var(--lf-space-2)' }}>
        <span>In your own words</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          maxLength={4000}
          required
          className="lf-input"
          placeholder="What was working with us like?"
        />
      </label>

      <label style={{ display: 'flex', gap: 'var(--lf-space-2)', alignItems: 'flex-start' }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>You may publish this publicly, including on your website.</span>
      </label>

      {consent && (
        <label style={{ display: 'grid', gap: 'var(--lf-space-2)' }}>
          <span>Name to show, if not your full name</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={120}
            className="lf-input"
            placeholder="e.g. A. K."
          />
        </label>
      )}

      {error && (
        <p role="alert" style={{ color: 'var(--lf-vermillion)' }}>
          {error}
        </p>
      )}

      <button type="submit" className="lf-btn" disabled={busy || rating === 0 || body.trim().length === 0}>
        {busy ? 'Sending…' : 'Send'}
      </button>
    </form>
  );
}
