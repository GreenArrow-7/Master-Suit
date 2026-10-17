'use client';

import { useState } from 'react';
import { send, useRun } from '@/components/forms/useRun';

/** Email this report on a cadence (M16-16): the CSV, to members of the workspace. */
export function ScheduleForm({ report, by, email }: { report: string; by?: string; email: string }) {
  const { busy, run, note } = useRun();
  const [cadence, setCadence] = useState('WEEKLY');
  const [recipients, setRecipients] = useState(email);
  return (
    <form
      className="lf-card"
      aria-label="Email this report"
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
            send('/api/v1/reports/schedules', 'POST', {
              report,
              ...(by && { by }),
              cadence,
              recipients: recipients
                .split(/[\s,;]+/)
                .map((r) => r.trim())
                .filter(Boolean),
            }),
          'Scheduled. It arrives at 07:00 as a CSV; stop it under Scheduled emails on the Reports page.',
        );
      }}
    >
      <div className="lf-eyebrow">Email this report</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--lf-space-2)', alignItems: 'flex-end' }}>
        <label className="lf-field" style={{ flex: '0 1 180px', minWidth: 0 }}>
          <span className="lf-label">How often</span>
          <select className="lf-select" value={cadence} onChange={(e) => setCadence(e.target.value)}>
            <option value="DAILY">Every day (yesterday)</option>
            <option value="WEEKLY">Every Monday (last week)</option>
            <option value="MONTHLY">On the 1st (last month)</option>
          </select>
        </label>
        <label className="lf-field" style={{ flex: '1 1 240px', minWidth: 0 }}>
          <span className="lf-label">To (members of this workspace)</span>
          <input
            className="lf-input"
            type="text"
            inputMode="email"
            required
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
          />
        </label>
        <button className="lf-btn lf-btn--secondary lf-btn--sm" disabled={busy}>
          Schedule
        </button>
      </div>
      {note}
    </form>
  );
}

export interface ScheduleRow {
  id: string;
  title: string;
  cadence: string;
  recipients: string[];
  next: string;
}

/** The viewer's scheduled report emails, each with its Stop. */
export function ScheduleList({ schedules }: { schedules: ScheduleRow[] }) {
  const { busy, run, note } = useRun();
  return (
    <section style={{ marginBottom: 'var(--lf-space-6)' }} aria-label="Scheduled emails">
      <h2 className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
        Scheduled emails
      </h2>
      <div className="lf-card" style={{ padding: 'var(--lf-space-2) var(--lf-space-4)' }}>
        {schedules.map((s) => (
          <div
            key={s.id}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--lf-space-2)',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--lf-space-2) 0',
              borderBottom: '1px solid var(--lf-line)',
            }}
          >
            <div style={{ minWidth: 0, flex: '1 1 220px' }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--lf-text-sm)' }}>{s.title}</div>
              <div style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)', overflowWrap: 'anywhere' }}>
                {s.cadence.toLowerCase()} to {s.recipients.join(', ')} · next {s.next}
              </div>
            </div>
            <button
              type="button"
              className="lf-btn lf-btn--secondary lf-btn--sm"
              disabled={busy}
              onClick={() => void run(() => send(`/api/v1/reports/schedules/${s.id}`, 'DELETE'), 'Stopped.')}
            >
              Stop
            </button>
          </div>
        ))}
      </div>
      {note}
    </section>
  );
}
