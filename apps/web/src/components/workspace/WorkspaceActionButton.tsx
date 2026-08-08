'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/auth/client';

/**
 * One HR workflow verb as a button. `promptFor` collects the field the API
 * requires before it will act — a rejection reason, an exit confirmation —
 * because those refusals are deliberate and a button that silently omits them
 * just produces a 409 the user cannot read.
 */
export default function WorkspaceActionButton({
  endpoint,
  body,
  label,
  confirm,
  promptFor,
  variant = 'default',
}: {
  endpoint: string;
  body: Record<string, unknown>;
  label: string;
  confirm?: string;
  promptFor?: { name: string; label: string; required?: boolean };
  variant?: 'default' | 'ghost' | 'danger';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [value, setValue] = useState('');

  async function send(extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const response = await authFetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, ...extra }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.detail ?? data.title ?? 'That action could not be completed.');
        return;
      }
      setAsking(false);
      setValue('');
      router.refresh();
    } catch {
      setError('The server could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  function start() {
    if (confirm && !window.confirm(confirm)) return;
    if (promptFor) {
      setAsking(true);
      return;
    }
    void send();
  }

  return (
    <span style={{ display: 'inline-grid', gap: 4 }}>
      {asking && promptFor ? (
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            className="lf-input"
            style={{ minWidth: 180 }}
            autoFocus
            placeholder={promptFor.label}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button
            className="lf-btn"
            type="button"
            disabled={busy || (promptFor.required !== false && !value.trim())}
            onClick={() => void send({ [promptFor.name]: value })}
          >
            {busy ? '…' : 'Confirm'}
          </button>
          <button
            className="lf-btn lf-btn--ghost"
            type="button"
            onClick={() => {
              setAsking(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          className={variant === 'default' ? 'lf-btn' : `lf-btn lf-btn--${variant}`}
          type="button"
          disabled={busy}
          onClick={start}
        >
          {busy ? 'Working…' : label}
        </button>
      )}
      {error && (
        <span className="lf-alert" role="alert" style={{ fontSize: 'var(--lf-text-xs)' }}>
          {error}
        </span>
      )}
    </span>
  );
}
