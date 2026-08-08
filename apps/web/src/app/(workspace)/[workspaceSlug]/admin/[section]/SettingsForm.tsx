'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface SettingsField {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'url' | 'number' | 'checkbox';
  value: string | boolean;
  hint?: string;
}

/**
 * The editor the administration area never had.
 *
 * Company profile, security posture, modules and subscription each rendered a
 * static two-column table — no form, no button, no input — so a workspace could
 * read its own settings and change none of them.
 *
 * `readOnly` covers the two sections that are genuinely not the workspace's to
 * change: modules and subscription belong to the platform owner. Those say so
 * and offer a way to ask, rather than showing a bare table that looks broken.
 */
export default function SettingsForm({
  endpoint,
  fields,
  canEdit,
  readOnlyReason,
}: {
  endpoint: string;
  fields: SettingsField[];
  canEdit: boolean;
  readOnlyReason?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, field.value])),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ tone: 'error', text: data.detail ?? 'That change was refused.' });
        return;
      }
      setMessage({ tone: 'ok', text: 'Saved.' });
      router.refresh();
    } catch {
      setMessage({ tone: 'error', text: 'Could not reach the server.' });
    } finally {
      setBusy(false);
    }
  }

  if (readOnlyReason) {
    return (
      <div className="lf-card" style={{ padding: 18, display: 'grid', gap: 12 }}>
        <p style={{ margin: 0, color: 'var(--lf-ink-2)', fontSize: 'var(--lf-text-sm)' }}>{readOnlyReason}</p>
        <div>
          <a
            className="lf-btn lf-btn--secondary lf-btn--sm"
            href="mailto:support@example.com?subject=Subscription%20change%20request"
          >
            Request a change
          </a>
        </div>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <p style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
        You can see these settings but not change them. That needs the workspace configuration permission.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="lf-card" style={{ padding: 18, display: 'grid', gap: 12 }}>
      {message && (
        <div className="lf-alert" role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </div>
      )}

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {fields.map((field) => (
          <label
            key={field.name}
            className="lf-field"
            style={field.type === 'checkbox' ? { flexDirection: 'row', alignItems: 'center', gap: 8 } : undefined}
          >
            {field.type === 'checkbox' ? (
              <>
                <input
                  type="checkbox"
                  checked={Boolean(values[field.name])}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.checked }))}
                />
                <span className="lf-label" style={{ margin: 0 }}>
                  {field.label}
                </span>
              </>
            ) : (
              <>
                <span className="lf-label">{field.label}</span>
                <input
                  className="lf-input"
                  type={field.type ?? 'text'}
                  value={String(values[field.name] ?? '')}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                />
              </>
            )}
            {field.hint && <span className="lf-hint">{field.hint}</span>}
          </label>
        ))}
      </div>

      <div>
        <button className="lf-btn" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
