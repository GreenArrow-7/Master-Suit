'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Field from '@/components/forms/Field';

export type MessageChannel = 'WHATSAPP' | 'EMAIL';

interface Template {
  key: string;
  name: string;
  subject?: string | null;
  body: string;
  language?: string;
}

/** One lead, from its page: the numbers marked as on WhatsApp, as the viewer reads them. */
interface OneLead {
  leadId: string;
  fullName: string;
  numbers: { id: string; label: string }[];
}

const CHANNEL: Readonly<Record<MessageChannel, string>> = { WHATSAPP: 'WhatsApp', EMAIL: 'Email' };
const HINT: Readonly<Record<number, string>> = { 1: 'Their first name', 2: 'Your name' };

/** How many `{{n}}` the template asks for. */
const slots = (template: Template | undefined) =>
  template
    ? Math.max(
        0,
        ...[...`${template.subject ?? ''} ${template.body}`.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])),
      )
    : 0;

/**
 * Send a WhatsApp template or an email template (M4-28), to one lead from its
 * page or, from the lead grid's Send template (M4-38), to every lead selected.
 * `{{1}}` and `{{2}}` are each lead's first name and the sender's unless typed;
 * any other is typed here. A native modal dialog, as the call log is.
 */
export default function TemplateSendDialog({
  channel: initial,
  target,
  onClose,
  onSent,
}: {
  channel: MessageChannel;
  target: OneLead | { leadIds: string[] };
  onClose: () => void;
  onSent: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const bulk = 'leadIds' in target;
  const [channel, setChannel] = useState<MessageChannel>(initial);
  /** The templates of the channel they were loaded for: another channel reads as still loading. */
  const [loaded, setLoaded] = useState<{ channel: MessageChannel; templates: Template[] } | null>(null);
  const templates = loaded?.channel === channel ? loaded.templates : null;
  const [key, setKey] = useState('');
  const [to, setTo] = useState(bulk ? '' : (target.numbers[0]?.id ?? ''));
  const [values, setValues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Kept until an answer comes: pressing Send again after a lost answer replays it, not doubles
  // it. Once answered ("Not sent", a refusal), Send again is a new request.
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);

  useEffect(() => {
    let live = true;
    fetch(channel === 'WHATSAPP' ? '/api/v1/whatsapp/templates' : '/api/v1/email-templates')
      .then((res) => (res.ok ? res.json() : { templates: [] }))
      .then((data: { templates: Template[] }) => live && setLoaded({ channel, templates: data.templates }))
      .catch(() => live && setLoaded({ channel, templates: [] }));
    return () => {
      live = false;
    };
  }, [channel]);

  const chosen = templates?.find((t) => t.key === key);
  const count = slots(chosen);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const variables = Array.from({ length: count }, (_, i) => values[i]?.trim() ?? '');
    const res = await fetch(bulk ? '/api/v1/leads/messages' : `/api/v1/leads/${target.leadId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': requestKey },
      body: JSON.stringify(
        bulk
          ? { leadIds: target.leadIds, channel, templateKey: key, variables }
          : { channel, templateKey: key, variables, ...(channel === 'WHATSAPP' && to && { to }) },
      ),
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
    if (!bulk && data.message?.status === 'FAILED') {
      setError(`Not sent: ${data.message.errorMessage ?? 'the provider refused it.'}`);
      return;
    }
    onSent();
    if (bulk) {
      const { queued, skipped } = data as {
        queued: number;
        skipped: { optedOut: number; noRecipient: number; notFound: number };
      };
      const missing = channel === 'WHATSAPP' ? 'with no number marked as on WhatsApp' : 'with no email address';
      setDone(
        [
          `${queued} queued, sent one a second.`,
          skipped.optedOut && `${skipped.optedOut} opted out.`,
          skipped.noRecipient && `${skipped.noRecipient} ${missing}.`,
          skipped.notFound && `${skipped.notFound} not yours to message.`,
        ]
          .filter(Boolean)
          .join(' '),
      );
      return;
    }
    ref.current?.close();
  }

  const title = bulk
    ? `Send template · ${target.leadIds.length} lead${target.leadIds.length === 1 ? '' : 's'}`
    : `Send ${CHANNEL[channel]} · ${target.fullName}`;

  return (
    <dialog ref={ref} className="lf-calllog" aria-labelledby={`${id}-title`} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--lf-space-3)', minWidth: 0 }}>
        <h2 id={`${id}-title`} className="lf-h2" style={{ fontSize: 'var(--lf-text-lg)', margin: 0 }}>
          {title}
        </h2>
        {bulk && (
          <Field label="Channel" htmlFor={`${id}-channel`}>
            <select
              id={`${id}-channel`}
              className="lf-input"
              value={channel}
              disabled={!!done}
              onChange={(e) => {
                setChannel(e.target.value as MessageChannel);
                setKey('');
                setValues([]);
              }}
            >
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
            </select>
          </Field>
        )}
        {!bulk && channel === 'WHATSAPP' && target.numbers.length > 1 && (
          <Field label="Number" htmlFor={`${id}-to`}>
            <select id={`${id}-to`} className="lf-input" value={to} onChange={(e) => setTo(e.target.value)}>
              {target.numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Template" htmlFor={`${id}-template`}>
          <select
            id={`${id}-template`}
            className="lf-input"
            required
            value={key}
            disabled={!templates || !!done}
            onChange={(e) => {
              setKey(e.target.value);
              setValues([]);
            }}
          >
            <option value="">
              {!templates
                ? 'Loading…'
                : templates.length
                  ? 'Choose a template…'
                  : channel === 'WHATSAPP'
                    ? 'No approved template'
                    : 'No email template yet'}
            </option>
            {templates?.map((t) => (
              <option key={t.key} value={t.key}>
                {t.language && channel === 'WHATSAPP' ? `${t.name} (${t.language})` : t.name}
              </option>
            ))}
          </select>
        </Field>
        {chosen && (
          <div
            className="lf-hint"
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 160, overflowY: 'auto' }}
          >
            {chosen.subject ? `${chosen.subject}\n\n${chosen.body}` : chosen.body}
          </div>
        )}
        {Array.from({ length: count }, (_, i) => (
          <Field key={i} label={`{{${i + 1}}}`} htmlFor={`${id}-v${i}`}>
            <input
              id={`${id}-v${i}`}
              className="lf-input"
              maxLength={500}
              required={!HINT[i + 1]}
              placeholder={HINT[i + 1] ?? ''}
              disabled={!!done}
              value={values[i] ?? ''}
              onChange={(e) =>
                setValues((prev) => {
                  const next = [...prev];
                  next[i] = e.target.value;
                  return next;
                })
              }
            />
          </Field>
        ))}
        {error && (
          <div className="lf-alert" role="alert" style={{ fontSize: 'var(--lf-text-sm)' }}>
            {error}
          </div>
        )}
        {done && (
          <p className="lf-hint" role="status" style={{ margin: 0 }}>
            {done}
          </p>
        )}
        <div style={{ display: 'flex', gap: 'var(--lf-space-2)', flexWrap: 'wrap' }}>
          {!done && (
            <button className="lf-btn lf-btn--sm" type="submit" disabled={busy || !key}>
              {busy ? 'Sending…' : bulk ? 'Queue' : 'Send'}
            </button>
          )}
          <button className="lf-btn lf-btn--secondary lf-btn--sm" type="button" onClick={() => ref.current?.close()}>
            {done ? 'Close' : 'Cancel'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
