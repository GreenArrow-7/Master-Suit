'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Draft {
  body: string;
  source: 'gemini' | 'template';
  recipientName: string | null;
  optedOut: boolean;
  conversationId: string | null;
  windowOpen: boolean;
  reason: string | null;
}

/**
 * The post-call WhatsApp follow-up: draft → edit → send into the lead's
 * existing WhatsApp thread. The send goes through the conversation reply
 * route, so the Meta service window is enforced server-side; when it is closed
 * the draft is still useful — copy it, or reopen with a template from Inbox.
 */
export default function WhatsAppFollowUp({ callId }: { callId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);

  async function requestDraft() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/calls/${callId}/follow-up-whatsapp`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? `Drafting failed (${res.status})`);
      setDraft(data);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function send() {
    if (!draft?.conversationId) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/conversations/${draft.conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft.body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? data.errors?.[0]?.message ?? `Send failed (${res.status})`);
      if (data.message?.status === 'FAILED') {
        throw new Error(data.message.errorMessage ?? 'The provider refused the message.');
      }
      setSent(true);
      setDraft(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function copy() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — select the text manually.');
    }
  }

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
        WhatsApp Follow-up
      </div>

      {error && (
        <div style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-sm)', marginBottom: 8 }}>{error}</div>
      )}
      {sent && (
        <div style={{ color: 'var(--lf-viridian)', fontSize: 'var(--lf-text-sm)', marginBottom: 8 }}>
          Sent into the WhatsApp thread.
        </div>
      )}

      {!draft ? (
        <button className="lf-btn lf-btn--secondary" onClick={requestDraft} disabled={busy}>
          {busy ? 'Drafting…' : 'Draft WhatsApp follow-up'}
        </button>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {draft.recipientName && (
            <div style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
              To: <strong>{draft.recipientName}</strong>
              {draft.optedOut && <span style={{ color: 'var(--lf-vermillion)' }}> — opted out of WhatsApp</span>}
            </div>
          )}
          {draft.source === 'template' && (
            <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)', fontStyle: 'italic' }}>
              Assembled from the call record without an AI provider — edit before sending.
            </div>
          )}
          <textarea
            className="lf-input"
            rows={5}
            maxLength={4096}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
          {draft.reason && (
            <div style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-brass, #a16207)' }}>{draft.reason}</div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            {draft.conversationId && draft.windowOpen && !draft.optedOut && (
              <button type="button" className="lf-btn" onClick={send} disabled={busy || !draft.body.trim()}>
                {busy ? 'Sending…' : 'Send'}
              </button>
            )}
            <button type="button" className="lf-btn lf-btn--secondary" onClick={copy} disabled={busy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="lf-btn lf-btn--ghost" onClick={() => setDraft(null)} disabled={busy}>
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
