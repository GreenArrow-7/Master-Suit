'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Complete / reopen / cancel / delete a task in place, against /api/v1/tasks/[id]. */
export default function TaskRowActions({ id, status, canDelete }: { id: string; status: string; canDelete: boolean }) {
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

  /**
   * Deleting is not cancelling. Cancelling keeps the task on the board as a
   * decision someone took; this takes it off. It is a soft delete — every task
   * list already filters `deletedAt` — but it is gone as far as the product is
   * concerned, so it confirms first.
   */
  async function remove() {
    if (!window.confirm('Delete this task? It will no longer appear in any list.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/tasks/${id}`, { method: 'DELETE' });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const deleteButton = canDelete ? (
    <button
      type="button"
      className="lf-btn lf-btn--secondary lf-btn--sm"
      style={{ color: 'var(--lf-vermillion)' }}
      disabled={busy}
      onClick={remove}
    >
      Delete
    </button>
  ) : null;

  if (status === 'COMPLETED' || status === 'CANCELLED') {
    return (
      <div style={{ display: 'flex', gap: 'var(--lf-space-2)', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="lf-btn lf-btn--secondary lf-btn--sm"
          disabled={busy}
          onClick={() => patch({ status: 'OPEN' })}
        >
          {status === 'COMPLETED' ? 'Reopen' : 'Restore'}
        </button>
        {deleteButton}
      </div>
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
      {deleteButton}
    </div>
  );
}
