'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Draft {
  subject: string;
  body: string;
  source: 'gemini' | 'template';
  to: string | null;
  recipientName: string | null;
  optedOut: boolean;
}

/**
 * Draft → edit → send, in place. The draft lives only in this component's
 * state: nothing is stored until the rep sends, at which point the server logs
 * it as a Communication and an Activity. The recipient is read-only by design —
 * the server resolves it from the call and ignores anything else.
 */
export default function FollowUpComposer({ callId }: { callId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function requestDraft() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/calls/${callId}/follow-up-email`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? `Drafting failed (${res.status})`);
      setDraft(data);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/calls/${callId}/follow-up-email`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: draft.subject, body: draft.body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? data.errors?.[0]?.message ?? `Send failed (${res.status})`);
      setSent(true);
      setDraft(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
        Follow-up Email
      </div>

      {error && (
        <div style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-sm)', marginBottom: 8 }}>{error}</div>
      )}
      {sent && (
        <div style={{ color: 'var(--lf-viridian)', fontSize: 'var(--lf-text-sm)', marginBottom: 8 }}>
          Sent and logged to the timeline.
        </div>
      )}

      {!draft ? (
        <button className="lf-btn lf-btn--secondary" onClick={requestDraft} disabled={busy}>
          {busy ? 'Drafting…' : 'Draft follow-up email'}
        </button>
      ) : (
        <form onSubmit={send} style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
            To: <strong>{draft.to ?? 'no email on this call’s contact or lead'}</strong>
            {draft.recipientName ? ` (${draft.recipientName})` : ''}
            {draft.optedOut && <span style={{ color: 'var(--lf-vermillion)' }}> — opted out of email</span>}
          </div>
          {draft.source === 'template' && (
            <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)', fontStyle: 'italic' }}>
              Assembled from the call record without an AI provider — edit before sending.
            </div>
          )}
          <input
            className="lf-input"
            value={draft.subject}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            required
            maxLength={200}
          />
          <textarea
            className="lf-input"
            rows={10}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            required
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="lf-btn" disabled={busy || !draft.to || draft.optedOut}>
              {busy ? 'Sending…' : 'Send'}
            </button>
            <button type="button" className="lf-btn lf-btn--ghost" onClick={() => setDraft(null)} disabled={busy}>
              Discard
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
