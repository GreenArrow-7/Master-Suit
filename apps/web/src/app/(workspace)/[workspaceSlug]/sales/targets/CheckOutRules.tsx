'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface CheckOutPolicy {
  requireTargetsBeforeCheckOut: boolean;
  checkOutQuotaMetrics: string[];
  checkOutQuotaMaxHours: number;
}

const LABELS: Record<string, string> = {
  CALLS_ATTEMPTED: 'Calls attempted',
  CALLS_CONNECTED: 'Calls connected',
  FOLLOWUPS_COMPLETED: 'Follow-ups completed',
  INVITATIONS_SENT: 'Invitations sent',
};

/**
 * Whether an unmet daily target stops somebody checking out.
 *
 * On this screen rather than in HR settings because it is the same decision as
 * the targets above it: whoever sets a hundred calls decides whether a hundred
 * calls is a condition of going home.
 *
 * Only the four effort metrics are offered. Conversions and qualifications are
 * not in the list and the server refuses them, because keeping somebody at
 * their desk until a stranger buys a flat is not a target.
 */
export default function CheckOutRules({
  policy,
  available,
}: {
  policy: CheckOutPolicy;
  available: readonly string[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<CheckOutPolicy>(policy);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const response = await fetch('/api/v1/targets/check-out-rules', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => ({}))) as { detail?: string; title?: string };
        throw new Error(failure.detail ?? failure.title ?? 'That did not work.');
      }
      setNote(
        draft.requireTargetsBeforeCheckOut
          ? 'Saved. An unmet daily target now stops check-out.'
          : 'Saved. Targets no longer affect check-out.',
      );
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const toggle = (metric: string, on: boolean) =>
    setDraft((current) => ({
      ...current,
      checkOutQuotaMetrics: on
        ? [...current.checkOutQuotaMetrics, metric]
        : current.checkOutQuotaMetrics.filter((entry) => entry !== metric),
    }));

  return (
    <section className="lf-card" style={{ padding: 18, display: 'grid', gap: 12, marginTop: 'var(--lf-space-6)' }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 'var(--lf-text-lg)' }}>Finishing the day</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>
          Whether an unmet daily target stops somebody checking out. Only daily targets count, and only the
          activity below — a conversion is not something an agent can finish by staying later.
        </p>
      </div>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={draft.requireTargetsBeforeCheckOut}
          onChange={(event) =>
            setDraft({ ...draft, requireTargetsBeforeCheckOut: event.target.checked })
          }
        />
        <span>Require the day&rsquo;s targets before check-out</span>
      </label>

      <fieldset
        disabled={!draft.requireTargetsBeforeCheckOut}
        style={{
          border: 0,
          padding: 0,
          margin: 0,
          display: 'grid',
          gap: 6,
          opacity: draft.requireTargetsBeforeCheckOut ? 1 : 0.5,
        }}
      >
        <legend style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)', padding: 0 }}>
          Which targets hold somebody back
        </legend>
        {available.map((metric) => (
          <label key={metric} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={draft.checkOutQuotaMetrics.includes(metric)}
              onChange={(event) => toggle(metric, event.target.checked)}
            />
            <span>{LABELS[metric] ?? metric}</span>
          </label>
        ))}

        <label style={{ display: 'grid', gap: 4, maxWidth: '18rem', marginTop: 8 }}>
          <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
            Stop holding anybody after (hours since check-in)
          </span>
          <input
            className="lf-input"
            type="number"
            min={4}
            max={16}
            value={draft.checkOutQuotaMaxHours}
            onChange={(event) => setDraft({ ...draft, checkOutQuotaMaxHours: Number(event.target.value) })}
          />
          <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>
            After this the shortfall is still recorded, but nobody is kept in. UAE labour law caps the working
            day, and a gate with no ceiling records unlawful hours.
          </span>
        </label>
      </fieldset>

      {note && <p style={{ margin: 0, color: 'var(--lf-viridian)' }}>{note}</p>}
      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--lf-vermillion)' }}>
          {error}
        </p>
      )}

      <div>
        <button
          type="button"
          className="lf-btn"
          disabled={busy || (draft.requireTargetsBeforeCheckOut && draft.checkOutQuotaMetrics.length === 0)}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
    </section>
  );
}
