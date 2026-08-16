'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Two-step delete for one audit verdict. Rendered only when the server said
 * the viewer holds `calls:DELETE` — administrator roles — and the endpoint
 * enforces the same permission again regardless.
 */
export default function AuditDelete({ callId, auditId }: { callId: string; auditId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/calls/${callId}/audit?auditId=${encodeURIComponent(auditId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? data.title ?? 'Could not delete this audit.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" className="lf-btn lf-btn--ghost lf-btn--sm" onClick={() => setConfirming(true)}>
        Delete
      </button>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--lf-space-2)' }}>
      {error && <span style={{ color: 'var(--lf-vermillion)', fontSize: 'var(--lf-text-2xs)' }}>{error}</span>}
      <button type="button" className="lf-btn lf-btn--danger lf-btn--sm" disabled={busy} onClick={remove}>
        {busy ? 'Deleting…' : 'Delete audit'}
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
