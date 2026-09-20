'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Inline "leads to call today" target for one seller. Posts a DAILY
 * LEADS_CALLED target covering the board's day; the board re-reads on save.
 */
export default function AssignDailyTarget({
  userId,
  date,
  current,
}: {
  userId: string;
  date: string;
  current: number | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const target = Number(value);
    if (!Number.isInteger(target) || target <= 0) {
      setError('Enter a whole number above zero.');
      return;
    }
    setBusy(true);
    setError('');
    const res = await fetch('/api/v1/targets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId,
        metric: 'LEADS_CALLED',
        period: 'DAILY',
        targetValue: target,
        periodStart: `${date}T00:00:00.000Z`,
        periodEnd: `${date}T23:59:59.999Z`,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.detail ?? data.title ?? 'Could not save the target');
      return;
    }
    router.refresh();
  }

  return (
    <form
      className="lf-daily-target"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        className="lf-input lf-daily-target__input"
        aria-label="Leads to call today"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy}
      />
      <button type="submit" className="lf-btn lf-btn--sm" disabled={busy}>
        {busy ? 'Saving…' : current === null ? 'Assign' : 'Update'}
      </button>
      {error && (
        <span role="alert" className="lf-daily-target__error">
          {error}
        </span>
      )}
    </form>
  );
}
