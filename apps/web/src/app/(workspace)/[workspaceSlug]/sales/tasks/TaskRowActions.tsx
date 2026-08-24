'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Complete / reopen / cancel a task in place, against PATCH /api/v1/tasks/[id]. */
export default function TaskRowActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (status === 'COMPLETED') {
    return (
      <button
        type="button"
        className="lf-btn lf-btn--secondary lf-btn--sm"
        disabled={busy}
        onClick={() => patch({ status: 'OPEN' })}
      >
        Reopen
      </button>
    );
  }
  if (status === 'CANCELLED') {
    return (
      <button
        type="button"
        className="lf-btn lf-btn--secondary lf-btn--sm"
        disabled={busy}
        onClick={() => patch({ status: 'OPEN' })}
      >
        Restore
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 'var(--lf-space-2)', justifyContent: 'flex-end' }}>
      <button
        type="button"
        className="lf-btn lf-btn--sm"
        disabled={busy}
        onClick={() => patch({ status: 'COMPLETED', completedAt: new Date().toISOString() })}
      >
        Complete
      </button>
      <button
        type="button"
        className="lf-btn lf-btn--secondary lf-btn--sm"
        disabled={busy}
        onClick={() => patch({ status: 'CANCELLED' })}
      >
        Cancel
      </button>
    </div>
  );
}
