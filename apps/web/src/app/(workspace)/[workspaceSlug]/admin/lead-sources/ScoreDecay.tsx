'use client';

import { useState } from 'react';
import { send, useRun } from '@/components/forms/useRun';

/**
 * The workspace's score decay (M4-11): every night, a lead loses some points
 * for each period without activity. Off until switched on here.
 */
export default function ScoreDecay({
  canEdit,
  decay,
}: {
  canEdit: boolean;
  decay: { decayDays: number; decayAmount: number; isActive: boolean } | null;
}) {
  const { busy, run, note } = useRun();
  const [form, setForm] = useState({
    decayDays: String(decay?.decayDays ?? 14),
    decayAmount: String(decay?.decayAmount ?? 5),
    isActive: decay?.isActive ?? false,
  });
  const number = (key: 'decayDays' | 'decayAmount', label: string, max: number) => (
    <input
      className="lf-input"
      type="number"
      min={1}
      max={max}
      required
      aria-label={label}
      disabled={!canEdit}
      value={form[key]}
      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      style={{ width: 72 }}
    />
  );
  return (
    <form
      className="lf-card"
      aria-label="Score decay"
      style={{
        padding: 'var(--lf-space-4)',
        marginTop: 'var(--lf-space-4)',
        display: 'grid',
        gap: 'var(--lf-space-3)',
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () =>
            send('/api/v1/lead-scoring', 'PUT', {
              decayDays: Number(form.decayDays),
              decayAmount: Number(form.decayAmount),
              isActive: form.isActive,
            }),
          'Saved.',
        );
      }}
    >
      <div className="lf-eyebrow">Lead score</div>
      <p style={{ margin: 0, fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}>
        A new lead starts at its source&rsquo;s points, and each activity logged on it adds its type&rsquo;s points.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 'var(--lf-text-sm)' }}>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
          />
          Decay:
        </label>
        a lead loses {number('decayAmount', 'Points lost', 100)} points for every{' '}
        {number('decayDays', 'Days without activity', 365)} days without activity.
      </div>
      {canEdit && (
        <div>
          <button className="lf-btn lf-btn--secondary lf-btn--sm" disabled={busy}>
            Save
          </button>
        </div>
      )}
      {note}
    </form>
  );
}
