'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import EntityDelete from '@/components/sales/EntityDelete';

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

  // Deleting is not cancelling: a cancelled task stays on the board as a decision
  // someone took; a deleted one (soft, `deletedAt`) leaves every list.
  const deleteButton = canDelete ? <EntityDelete endpoint={`/api/v1/tasks/${id}`} label="task" /> : null;

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
