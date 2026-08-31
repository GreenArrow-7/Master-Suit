'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface EditableField {
  name: string;
  label: string;
  type?: 'text' | 'date' | 'number';
  value?: string | number | null;
}

/**
 * Per-row Edit and Archive, against the HR write verbs added in 4.5.
 *
 * Until those existed there was nothing for a row to do: every HR list was
 * output-only, so a record created with a typo could never be corrected and
 * somebody who left could never be archived.
 *
 * Archive is a two-step confirm rather than a `confirm()` dialog — a browser
 * modal blocks the whole page and cannot be styled or tested.
 */
export default function RowActions({
  endpoint,
  id,
  fields,
  archiveLabel = 'Archive',
  canEdit = true,
}: {
  /** Collection endpoint; `?id=` is appended. */
  endpoint: string;
  id: string;
  fields: EditableField[];
  archiveLabel?: string;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'editing' | 'confirming'>('idle');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, field.value == null ? '' : String(field.value)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) return null;

  async function send(method: 'PATCH' | 'DELETE', body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${endpoint}?id=${encodeURIComponent(id)}`, {
        method,
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? 'That did not work.');
        return;
      }
      setMode('idle');
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'editing') {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send('PATCH', values);
        }}
        style={{ display: 'grid', gap: 6, minWidth: 220 }}
      >
        {error && (
          <span role="alert" style={{ color: 'var(--lf-danger)', fontSize: 'var(--lf-text-xs)' }}>
            {error}
          </span>
        )}
        {fields.map((field) => (
          <label key={field.name} style={{ display: 'grid', gap: 2, fontSize: 'var(--lf-text-xs)' }}>
            <span style={{ color: 'var(--lf-ink-3)' }}>{field.label}</span>
            <input
              className="lf-input"
              type={field.type ?? 'text'}
              value={values[field.name] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
            />
          </label>
        ))}
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="lf-btn lf-btn--sm" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            className="lf-btn lf-btn--ghost lf-btn--sm"
            type="button"
            onClick={() => {
              setMode('idle');
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  if (mode === 'confirming') {
    return (
      <div style={{ display: 'grid', gap: 6, minWidth: 200 }}>
        {error && (
          <span role="alert" style={{ color: 'var(--lf-danger)', fontSize: 'var(--lf-text-xs)' }}>
            {error}
          </span>
        )}
        <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>{archiveLabel} this record?</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="lf-btn lf-btn--danger lf-btn--sm" onClick={() => void send('DELETE')} disabled={busy}>
            {busy ? 'Working…' : `Yes, ${archiveLabel.toLowerCase()}`}
          </button>
          <button
            className="lf-btn lf-btn--ghost lf-btn--sm"
            onClick={() => {
              setMode('idle');
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button className="lf-btn lf-btn--ghost lf-btn--sm" onClick={() => setMode('editing')}>
        Edit
      </button>
      <button className="lf-btn lf-btn--ghost lf-btn--sm" onClick={() => setMode('confirming')}>
        {archiveLabel}
      </button>
    </div>
  );
}
