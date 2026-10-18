'use client';

import { useState } from 'react';
import { authFetch } from '@/lib/auth/client';

/**
 * "Available for new leads" (audit M7-07): off, automatic assignment passes
 * this person over ("marked unavailable") until they switch it back on.
 */
export default function AvailabilityToggle({ slug, initial }: { slug: string; initial: boolean }) {
  const [available, setAvailable] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    const response = await authFetch(`/api/v1/workspaces/${slug}/identity/self/lead-availability`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isAvailable: next }),
    }).catch(() => null);
    setBusy(false);
    if (response?.ok) setAvailable(next);
    else setError('Could not save. Try again.');
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label style={{ display: 'flex', gap: 'var(--lf-space-2)', alignItems: 'center', fontWeight: 500 }}>
        <input type="checkbox" checked={available} disabled={busy} onChange={(event) => toggle(event.target.checked)} />
        Available for new leads
      </label>
      <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-3)' }}>
        {available
          ? 'New leads come to you in turn.'
          : 'Automatic assignment passes you over until you switch this back on.'}
      </span>
      {error && (
        <span role="alert" style={{ color: 'var(--lf-danger)', fontSize: 'var(--lf-text-sm)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
