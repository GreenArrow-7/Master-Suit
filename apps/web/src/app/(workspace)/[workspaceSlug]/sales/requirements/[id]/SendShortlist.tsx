'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface MatchOption {
  id: string;
  title: string;
  price: string;
  currency: string;
  community: string | null;
}

/**
 * Turn what matches into something the client can actually look at.
 *
 * Everything is ticked to start with, because the agent already narrowed this
 * list by writing the requirement — asking them to tick six boxes to send the
 * six properties the screen just recommended is work for its own sake.
 *
 * It creates a draft and opens it. Sending is a second, deliberate action on
 * the proposal itself: the covering note usually wants a read before it goes to
 * a client, and a single button that both writes and publishes is how the wrong
 * shortlist reaches the wrong person.
 */
export default function SendShortlist({
  leadId,
  contactId,
  requirementId,
  clientName,
  matches,
  workspaceSlug,
}: {
  leadId: string | null;
  contactId: string | null;
  requirementId: string;
  clientName: string;
  matches: MatchOption[];
  workspaceSlug: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(matches.slice(0, 20).map((match) => match.id));
  const [title, setTitle] = useState(`A few places for ${clientName}`);
  const [message, setMessage] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          leadId,
          contactId,
          requirementId,
          title: title.trim(),
          message: message.trim() || null,
          listingIds: picked,
          expiresInDays: expiresInDays ? Number(expiresInDays) : null,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { id?: string; detail?: string; title?: string };
      if (!response.ok || !result.id) throw new Error(result.detail ?? result.title ?? 'That did not work.');
      router.push(`/${workspaceSlug}/sales/proposals/${result.id}`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That did not work.');
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="lf-btn" disabled={matches.length === 0} onClick={() => setOpen(true)}>
        Send a shortlist
      </button>
    );
  }

  return (
    <div className="lf-card" style={{ padding: 18, display: 'grid', gap: 12 }}>
      <strong>Send a shortlist</strong>

      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>What the client sees at the top</span>
        <input className="lf-input" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
      </label>

      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
          A note from you (optional)
        </span>
        <textarea
          className="lf-input"
          rows={3}
          maxLength={2000}
          value={message}
          placeholder="These are the three closest to the school. The second is under offer, so worth seeing first."
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>

      <label style={{ display: 'grid', gap: 4, maxWidth: '14rem' }}>
        <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
          The link stops working after (days)
        </span>
        <input
          className="lf-input"
          type="number"
          min={1}
          max={180}
          value={expiresInDays}
          onChange={(event) => setExpiresInDays(event.target.value)}
        />
      </label>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 6 }}>
        <legend style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)', padding: 0 }}>
          {picked.length} of {matches.length} properties
        </legend>
        {matches.slice(0, 20).map((match) => (
          <label key={match.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <input
              type="checkbox"
              checked={picked.includes(match.id)}
              onChange={(event) =>
                setPicked((current) =>
                  event.target.checked ? [...current, match.id] : current.filter((id) => id !== match.id),
                )
              }
            />
            <span>
              {match.title}
              <span style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-xs)' }}>
                {match.community ? ` · ${match.community}` : ''} · {match.currency}{' '}
                {Number(match.price).toLocaleString('en-AE')}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--lf-vermillion)' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="lf-btn" disabled={busy || picked.length === 0} onClick={() => void create()}>
          Build it
        </button>
        <button type="button" className="lf-btn lf-btn--ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
