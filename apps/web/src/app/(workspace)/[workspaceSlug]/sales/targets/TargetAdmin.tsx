'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { METRICS } from './metrics';
import Field from '@/components/forms/Field';

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
        <Field label="Teammate" htmlFor="tg-user">
          <select id="tg-user" className="lf-input" value={form.userId} onChange={set('userId')} required>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </select>
        </Field>

        <Field label="What to achieve" htmlFor="tg-metric">
          <select id="tg-metric" className="lf-input" value={form.metric} onChange={set('metric')}>
            {METRICS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="How many" htmlFor="tg-value">
          <input
            id="tg-value"
            className="lf-input"
            type="number"
            min={1}
            value={form.targetValue}
            onChange={set('targetValue')}
            required
          />
        </Field>

        <Field label="Cadence" htmlFor="tg-period">
          <select id="tg-period" className="lf-input" value={form.period} onChange={set('period')}>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
          </select>
        </Field>

        <Field label="From" htmlFor="tg-start">
          <input
            id="tg-start"
            className="lf-input"
            type="date"
            value={form.periodStart}
            onChange={set('periodStart')}
            required
          />
        </Field>

        <Field label="To" htmlFor="tg-end">
          <input
            id="tg-end"
            className="lf-input"
            type="date"
            value={form.periodEnd}
            onChange={set('periodEnd')}
            required
          />
        </Field>
      </div>

      <div>
        <button className="lf-btn" type="submit" disabled={busy || !form.userId}>
          {busy ? 'Assigning…' : 'Assign target'}
        </button>
      </div>
    </form>
  );
}
