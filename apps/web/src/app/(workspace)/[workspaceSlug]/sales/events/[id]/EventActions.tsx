'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Result = { ok: boolean; text: string };

/**
 * Circulating an event and queueing its call list are both batched, capped server
 * side, and safe to re-run — the API skips invitees already notified or queued.
 */
export default function EventActions({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState<'invite' | 'calls' | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function post(path: string, body: unknown, kind: 'invite' | 'calls') {
    setBusy(kind);
    setResult(null);
    const res = await fetch(`/api/v1/events/${eventId}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setResult({ ok: false, text: data.detail ?? data.title ?? 'Request failed' });
      return;
    }
    setResult({
      ok: true,
      text: kind === 'invite'
        ? `${data.sent} sent, ${data.failed} failed, ${data.remaining} still to go.`
        : `${data.queued} calls queued, ${data.skipped} already in the queue.`,
    });
    router.refresh();
  }

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)', marginBottom: 'var(--lf-space-4)' }}>
      <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>Circulate and call</div>

      <div style={{ display: 'flex', gap: 'var(--lf-space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px' }}>
          <label className="lf-label" htmlFor="template">Approved WhatsApp template</label>
          <input
            className="lf-input" id="template" value={template} placeholder="event_invite_v1"
            onChange={(event) => setTemplate(event.target.value)}
          />
        </div>
        <button
          className="lf-btn" disabled={!template.trim() || busy !== null}
          onClick={() => post('invite', { template: template.trim() }, 'invite')}
        >
          {busy === 'invite' ? 'Sending…' : 'Send on WhatsApp'}
        </button>
        <button
          className="lf-btn lf-btn--ghost" disabled={busy !== null}
          onClick={() => post('calls', {}, 'calls')}
        >
          {busy === 'calls' ? 'Queueing…' : 'Queue calls to me'}
        </button>
      </div>

      <p style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)', marginTop: 'var(--lf-space-3)' }}>
        WhatsApp Business only delivers pre-approved templates for business-initiated
        messages. The template receives the invitee name, event title, start time and
        location or meeting link, in that order.
      </p>

      {result && (
        <p style={{ marginTop: 'var(--lf-space-3)', fontSize: 'var(--lf-text-sm)', color: result.ok ? 'var(--lf-viridian)' : 'var(--lf-vermillion)' }}>
          {result.text}
        </p>
      )}
    </section>
  );
}
