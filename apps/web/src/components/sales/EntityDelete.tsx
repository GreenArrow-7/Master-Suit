'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useModuleBase } from '@/components/workspace/SalesLink';

/**
 * Two-step delete for a detail page: a quiet button that asks before it commits,
 * then sends the viewer back to the list the record came from.
 */
export default function EntityDelete({
  endpoint,
  backHref,
  label,
}: {
  /** Absolute API path, e.g. `/api/v1/accounts/${id}`. */
  endpoint: string;
  /** Module-relative list path to return to, e.g. `/accounts`. */
  backHref: string;
  /** Lower-case noun for the buttons, e.g. "account". */
  label: string;
}) {
  const router = useRouter();
  const base = useModuleBase();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(endpoint, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? data.title ?? `Could not delete this ${label}.`);
        return;
      }
      router.push(`${base}${backHref}`);
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setConfirming(true)}>
        Delete
      </button>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--lf-space-2)' }}>
      {error && <span style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-2xs)' }}>{error}</span>}
      <button type="button" className="lf-btn lf-btn--danger lf-btn--sm" disabled={busy} onClick={remove}>
        {busy ? 'Deleting…' : `Delete ${label}`}
      </button>
      <button
        type="button"
        className="lf-btn lf-btn--secondary lf-btn--sm"
        disabled={busy}
        onClick={() => setConfirming(false)}
      >
        Keep
      </button>
    </span>
  );
}
