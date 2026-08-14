'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Inline editor for one platform setting. The server validates against the
 * setting's own rule; this only carries the value and shows what came back.
 */
export default function SettingEditor({
  settingKey,
  value,
  hint,
}: {
  settingKey: string;
  value: string;
  hint?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/platform/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: settingKey, value: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? data.title ?? 'That did not work.');
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <strong>{value}</strong>
        <button type="button" className="lf-btn lf-btn--secondary" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 6, maxWidth: 260 }}>
      <input
        className="lf-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label={settingKey}
        autoFocus
      />
      {hint && <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>{hint}</span>}
      {error && (
        <div role="alert" style={{ color: 'var(--lf-danger, #B00020)', fontSize: 'var(--lf-text-xs)' }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="lf-btn" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="lf-btn lf-btn--secondary" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
