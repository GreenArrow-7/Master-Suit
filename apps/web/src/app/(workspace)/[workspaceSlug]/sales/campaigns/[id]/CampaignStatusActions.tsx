'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Move a campaign through its status machine, against PATCH /api/v1/campaigns/[id]. */
const MOVES: Record<string, [label: string, next: string, secondary?: boolean][]> = {
  DRAFT: [['Start', 'RUNNING']],
  SCHEDULED: [['Start now', 'RUNNING']],
  RUNNING: [
    ['Pause', 'PAUSED', true],
    ['Complete', 'COMPLETED', true],
  ],
  PAUSED: [
    ['Resume', 'RUNNING'],
    ['Complete', 'COMPLETED', true],
  ],
  COMPLETED: [],
  CANCELLED: [],
};

export default function CampaignStatusActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(next: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? 'Could not update the campaign.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const moves = MOVES[status] ?? [];
  if (moves.length === 0) return null;

  return (
    <span style={{ display: 'inline-flex', gap: 'var(--lf-space-2)', alignItems: 'center' }}>
      {moves.map(([label, next, secondary]) => (
        <button
          key={next + label}
          type="button"
          className={`lf-btn lf-btn--sm${secondary ? ' lf-btn--secondary' : ''}`}
          disabled={busy}
          onClick={() => move(next)}
        >
          {label}
        </button>
      ))}
      {error && (
        <span role="alert" style={{ color: 'var(--lf-vermillion, #b3261e)', fontSize: 'var(--lf-text-xs)' }}>
          {error}
        </span>
      )}
    </span>
  );
}
