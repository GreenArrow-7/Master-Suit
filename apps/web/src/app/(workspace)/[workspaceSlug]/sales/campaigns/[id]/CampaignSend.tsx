'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Sends the promotional message to the campaign's leads. Only leads with GRANTED or
 * IMPLIED consent and no do-not-call flag are contacted; the server enforces that,
 * and re-running skips anyone already messaged.
 */
export default function CampaignSend({ campaignId, eligible }: { campaignId: string; eligible: number }) {
  const router = useRouter();
  const [template, setTemplate] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/v1/campaigns/${campaignId}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template: template.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setMessage(
      res.ok
        ? { ok: true, text: `${data.sent} sent, ${data.failed} failed, ${data.remaining} still eligible.` }
        : { ok: false, text: data.detail ?? data.title ?? 'Send failed' },
    );
    if (res.ok) router.refresh();
  }

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)', marginBottom: 'var(--lf-space-5)' }}>
      <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
        Promotional send
      </div>
      <div style={{ display: 'flex', gap: 'var(--lf-space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px' }}>
          <label className="lf-label" htmlFor="campaign-template">
            Approved WhatsApp template
          </label>
          <input
            className="lf-input"
            id="campaign-template"
            value={template}
            placeholder="promo_launch_v1"
            onChange={(event) => setTemplate(event.target.value)}
          />
        </div>
        <button className="lf-btn" disabled={!template.trim() || busy} onClick={send}>
          {busy ? 'Sending…' : `Send to ${eligible} lead${eligible === 1 ? '' : 's'}`}
        </button>
      </div>
      <p style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)', marginTop: 'var(--lf-space-3)' }}>
        The template receives the lead name then the campaign name. Leads without marketing consent, or flagged
        do-not-call, are excluded from the count above.
      </p>
      {message && (
        <p
          style={{
            marginTop: 'var(--lf-space-3)',
            fontSize: 'var(--lf-text-sm)',
            color: message.ok ? 'var(--lf-viridian)' : 'var(--lf-vermillion)',
          }}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
