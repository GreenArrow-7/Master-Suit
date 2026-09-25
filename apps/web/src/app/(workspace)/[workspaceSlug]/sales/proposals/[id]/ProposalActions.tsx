'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Send it, copy the link, or withdraw it.
 *
 * The link only appears once the proposal has been sent. A link shown beside a
 * draft is a link somebody pastes into WhatsApp anyway, and a half-finished
 * shortlist is the one thing that must not reach a client.
 */
export default function ProposalActions({
  id,
  status,
  url,
  expiresAt,
}: {
  id: string;
  status: string;
  url: string | null;
  expiresAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: 'send' | 'withdraw') {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const response = await fetch(`/api/v1/proposals/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => ({}))) as { detail?: string; title?: string };
        throw new Error(failure.detail ?? failure.title ?? 'That did not work.');
      }
      setNote(action === 'send' ? 'Live. Send the client the link below.' : 'Withdrawn. The link no longer opens.');
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lf-card" style={{ padding: 18, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {status !== 'SENT' && status !== 'CLOSED' && (
          <button type="button" className="lf-btn" disabled={busy} onClick={() => void act('send')}>
            Send it
          </button>
        )}
        {status === 'SENT' && (
          <button type="button" className="lf-btn lf-btn--ghost" disabled={busy} onClick={() => void act('withdraw')}>
            Withdraw
          </button>
        )}
        {status === 'CLOSED' && (
          <span style={{ color: 'var(--lf-ink-3)' }}>Withdrawn. The link no longer opens.</span>
        )}
        {expiresAt && status === 'SENT' && (
          <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
            The link stops working on {new Date(expiresAt).toLocaleDateString('en-GB')}
          </span>
        )}
      </div>

      {url && (
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
            The client&rsquo;s link. Anybody holding it can open the shortlist, so send it to them and not to a group.
          </span>
          <input
            className="lf-input"
            readOnly
            defaultValue={url}
            onFocus={(event) => event.currentTarget.select()}
            style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'var(--lf-text-xs)' }}
          />
        </label>
      )}

      {note && <p style={{ margin: 0, color: 'var(--lf-viridian)' }}>{note}</p>}
      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--lf-vermillion)' }}>
          {error}
        </p>
      )}
    </section>
  );
}
