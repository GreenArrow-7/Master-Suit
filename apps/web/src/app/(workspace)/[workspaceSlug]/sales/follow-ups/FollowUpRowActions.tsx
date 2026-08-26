'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Complete / reschedule a follow-up in place, against PATCH /api/v1/follow-ups/[id]. */
export default function FollowUpRowActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [dueAt, setDueAt] = useState('');

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/follow-ups/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setRescheduling(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  if (status === 'COMPLETED' || status === 'CANCELLED') {
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

  if (rescheduling) {
    return (
      <span style={{ display: 'inline-flex', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
        <input
          type="datetime-local"
          className="lf-input"
          style={{ maxWidth: 200 }}
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          aria-label="New due date"
        />
        <button
          type="button"
          className="lf-btn lf-btn--sm"
          disabled={busy || !dueAt}
          onClick={() => patch({ dueAt: new Date(dueAt).toISOString() })}
        >
          Save
        </button>
        <button
          type="button"
          className="lf-btn lf-btn--secondary lf-btn--sm"
          disabled={busy}
          onClick={() => setRescheduling(false)}
        >
          Back
        </button>
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', gap: 'var(--lf-space-2)', justifyContent: 'flex-end' }}>
      <button
        type="button"
        className="lf-btn lf-btn--sm"
        disabled={busy}
        onClick={() => patch({ status: 'COMPLETED' })}
      >
        Complete
      </button>
      <button
        type="button"
        className="lf-btn lf-btn--secondary lf-btn--sm"
        disabled={busy}
        onClick={() => setRescheduling(true)}
      >
        Reschedule
      </button>
      <button
        type="button"
        className="lf-btn lf-btn--secondary lf-btn--sm"
        disabled={busy}
        onClick={() => patch({ status: 'CANCELLED' })}
      >
        Cancel
      </button>
    </span>
  );
}
