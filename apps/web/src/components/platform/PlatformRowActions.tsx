'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface PlatformEditField {
  name: string;
  label: string;
  type?: 'text' | 'date' | 'select';
  value?: string | null;
  options?: { value: string; label: string }[];
}

/**
 * Per-row Edit and Delete for the platform console lists.
 *
 * Differs from the workspace RowActions in two ways that matter here: the
 * endpoint is a full path (platform routes carry the id as a path segment, not
 * `?id=`), and select fields are first-class because most platform edits are a
 * choice between states — a plan, a role, a status — not free text.
 *
 * Delete is a two-step confirm. The wording comes from the caller because
 * "Delete" means different things per resource (archive a workspace, cancel a
 * subscription, deactivate a user) and the button must say which.
 */
export default function PlatformRowActions({
  endpoint,
  fields,
  deleteLabel = 'Delete',
  deleteWarning = 'This cannot be undone from here.',
}: {
  endpoint: string;
  fields: PlatformEditField[];
  deleteLabel?: string;
  deleteWarning?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'editing' | 'confirming'>('idle');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, field.value ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: 'PATCH' | 'DELETE', body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method,
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? data.title ?? 'That did not work.');
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
      <div style={{ display: 'grid', gap: 8, minWidth: 220 }}>
        {fields.map((field) => (
          <label key={field.name} style={{ display: 'grid', gap: 2, fontSize: 'var(--lf-text-xs)' }}>
            <span className="lf-eyebrow">{field.label}</span>
            {field.type === 'select' ? (
              <select
                className="lf-input"
                value={values[field.name]}
                onChange={(event) => setValues((prev) => ({ ...prev, [field.name]: event.target.value }))}
              >
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="lf-input"
                type={field.type ?? 'text'}
                value={values[field.name]}
                onChange={(event) => setValues((prev) => ({ ...prev, [field.name]: event.target.value }))}
              />
            )}
          </label>
        ))}
        {error && (
          <div role="alert" style={{ color: 'var(--lf-danger, #B00020)', fontSize: 'var(--lf-text-xs)' }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="lf-btn"
            disabled={busy}
            onClick={() => {
              // Only send what changed; empty strings mean "leave alone" for
              // dates and text, so a blank field never nulls a value by accident.
              const changes: Record<string, unknown> = {};
              for (const field of fields) {
                const next = values[field.name];
                if (next !== (field.value ?? '') && next !== '') changes[field.name] = next;
              }
              if (Object.keys(changes).length === 0) {
                setMode('idle');
                return;
              }
              void send('PATCH', changes);
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="lf-btn lf-btn--secondary" disabled={busy} onClick={() => setMode('idle')}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'confirming') {
    return (
      <div style={{ display: 'grid', gap: 6, minWidth: 200 }}>
        <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>{deleteWarning}</span>
        {error && (
          <div role="alert" style={{ color: 'var(--lf-danger, #B00020)', fontSize: 'var(--lf-text-xs)' }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="lf-btn lf-btn--danger" disabled={busy} onClick={() => void send('DELETE')}>
            {busy ? 'Working…' : `Confirm ${deleteLabel.toLowerCase()}`}
          </button>
          <button type="button" className="lf-btn lf-btn--secondary" disabled={busy} onClick={() => setMode('idle')}>
            Keep
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6, whiteSpace: 'nowrap' }}>
      {fields.length > 0 && (
        <button type="button" className="lf-btn lf-btn--secondary" onClick={() => setMode('editing')}>
          Edit
        </button>
      )}
      <button type="button" className="lf-btn lf-btn--danger" onClick={() => setMode('confirming')}>
        {deleteLabel}
      </button>
    </div>
  );
}
