'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Field from '@/components/forms/Field';
import { SMS_MAX_LENGTH, smsParts } from '@/lib/sms';

/**
 * Write and send a text to the lead (M4-29), from its page: a native modal
 * dialog, as the template send is, with a count of the characters and the SMS
 * parts they take. A text the provider refuses is still on the timeline, marked
 * failed, and the reason shows here.
 */
export default function SmsDialog({
  lead,
  onClose,
  onSent,
}: {
  lead: { id: string; fullName: string };
  onClose: () => void;
  onSent: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept until an answer comes: Send again after a lost answer replays it, not doubles it.
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const { parts, perPart, unicode } = smsParts(text);

  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/leads/${lead.id}/sms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': requestKey },
      body: JSON.stringify({ body: text }),
    }).catch(() => null);
    setBusy(false);
    if (res) setRequestKey(crypto.randomUUID());
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) {
      setError(
        data?.errors?.[0]?.message ?? data?.detail ?? (res ? `Request failed (${res.status})` : 'No connection.'),
      );
      return;
    }
    // QUEUED after the send: the provider never answered, so it may have gone; the message says so.
    if (data.message?.status === 'FAILED' || data.message?.status === 'QUEUED') {
      const { status, errorMessage } = data.message;
      setError(status === 'FAILED' ? `Not sent: ${errorMessage ?? 'the provider refused it.'}` : errorMessage);
      router.refresh();
      return;
    }
    onSent();
    ref.current?.close();
  }

  return (
    <dialog ref={ref} className="lf-calllog" aria-labelledby={`${id}-title`} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--lf-space-3)', minWidth: 0 }}>
        <h2 id={`${id}-title`} className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>
          Send SMS · {lead.fullName}
        </h2>
        <Field label="Message" htmlFor={`${id}-body`} required>
          <textarea
            id={`${id}-body`}
            className="lf-input"
            rows={5}
            required
            maxLength={SMS_MAX_LENGTH}
            value={text}
            aria-describedby={`${id}-count`}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <p id={`${id}-count`} className="lf-hint" aria-live="polite" style={{ margin: 0 }}>
          {text.length} / {SMS_MAX_LENGTH} characters · {parts} SMS {parts === 1 ? 'part' : 'parts'} of {perPart}
          {unicode ? ' (Arabic or emoji: fewer characters a part)' : ''}
        </p>
        {error && (
          <div className="lf-alert" role="alert" style={{ fontSize: 'var(--lf-text-sm)' }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
          <button className="lf-btn lf-btn--sm" type="submit" disabled={busy || !text.trim()}>
            {busy ? 'Sending…' : 'Send'}
          </button>
          <button className="lf-btn lf-btn--secondary lf-btn--sm" type="button" onClick={() => ref.current?.close()}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
