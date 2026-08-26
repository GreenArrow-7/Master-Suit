'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { METRICS } from './metrics';

/**
 * Assign a sales target to a teammate — the form the Targets page was missing.
 * POST /api/v1/targets already existed behind leads:ASSIGN; this wires to it.
 */

export default function TargetAdmin({ users }: { users: { id: string; fullName: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monday = () => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  // Lazy initialiser: the clock reads once on mount, not on every render.
  const [form, setForm] = useState(() => ({
    userId: users[0]?.id ?? '',
    metric: 'CALLS_ATTEMPTED',
    period: 'WEEKLY',
    targetValue: '25',
    periodStart: monday(),
    periodEnd: inDays(6),
  }));

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/targets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: form.userId,
          metric: form.metric,
          period: form.period,
          targetValue: Number(form.targetValue),
          periodStart: new Date(form.periodStart).toISOString(),
          periodEnd: new Date(`${form.periodEnd}T23:59:59`).toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? 'Could not assign this target.');
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="lf-btn lf-btn--sm" onClick={() => setOpen(true)}>
        Assign target
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="lf-card"
      style={{ padding: 'var(--lf-space-5)', display: 'grid', gap: 'var(--lf-space-4)' }}
      noValidate
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--lf-text-lg)' }}>Assign a target</h2>
        <button
          type="button"
          className="lf-btn lf-btn--secondary lf-btn--sm"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>

      {error && (
        <div className="lf-alert" role="alert">
          {error}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--lf-space-4)',
        }}
      >
        <div className="lf-field">
          <label className="lf-label" htmlFor="tg-user">
            Teammate
          </label>
          <select id="tg-user" className="lf-input" value={form.userId} onChange={set('userId')} required>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </select>
        </div>

        <div className="lf-field">
          <label className="lf-label" htmlFor="tg-metric">
            What to achieve
          </label>
          <select id="tg-metric" className="lf-input" value={form.metric} onChange={set('metric')}>
            {METRICS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="lf-field">
          <label className="lf-label" htmlFor="tg-value">
            How many
          </label>
          <input
            id="tg-value"
            className="lf-input"
            type="number"
            min={1}
            value={form.targetValue}
            onChange={set('targetValue')}
            required
          />
        </div>

        <div className="lf-field">
          <label className="lf-label" htmlFor="tg-period">
            Cadence
          </label>
          <select id="tg-period" className="lf-input" value={form.period} onChange={set('period')}>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
          </select>
        </div>

        <div className="lf-field">
          <label className="lf-label" htmlFor="tg-start">
            From
          </label>
          <input
            id="tg-start"
            className="lf-input"
            type="date"
            value={form.periodStart}
            onChange={set('periodStart')}
            required
          />
        </div>

        <div className="lf-field">
          <label className="lf-label" htmlFor="tg-end">
            To
          </label>
          <input
            id="tg-end"
            className="lf-input"
            type="date"
            value={form.periodEnd}
            onChange={set('periodEnd')}
            required
          />
        </div>
      </div>

      <div>
        <button className="lf-btn" type="submit" disabled={busy || !form.userId}>
          {busy ? 'Assigning…' : 'Assign target'}
        </button>
      </div>
    </form>
  );
}

/** Withdraw an assigned target. */
export function TargetDelete({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/targets/${id}`, { method: 'DELETE' });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={() => setConfirming(true)}>
        Withdraw
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 'var(--lf-space-2)' }}>
      <button type="button" className="lf-btn lf-btn--sm" disabled={busy} onClick={remove}>
        {busy ? 'Removing…' : 'Confirm'}
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
