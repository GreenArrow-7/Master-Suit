'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge, { type Tone } from '@/components/ui/Badge';

export interface TemperatureView {
  temperature: string;
  score: number;
  reasons: { text: string; delta: number }[];
}

const TONE: Record<string, Tone> = {
  READY_TO_ACT: 'viridian',
  HOT: 'viridian',
  WARM: 'brass',
  COLD: 'slate',
};

/**
 * The explainable post-call temperature. Every point is a visible signed
 * reason; nothing reaches the lead until the agent applies it, and the server
 * recomputes from the stored analysis rather than trusting this view.
 */
export default function TemperaturePanel({
  callId,
  result,
  leadScore,
  canApply,
}: {
  callId: string;
  result: TemperatureView;
  leadScore: number;
  canApply: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');

  async function apply() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/calls/${callId}/temperature`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? data.errors?.[0]?.message ?? `Apply failed (${res.status})`);
      setApplied(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <section className="lf-card" style={{ padding: 'var(--lf-space-5)' }}>
      <div className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-3)' }}>
        Lead temperature
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--lf-space-3)' }}>
        <Badge tone={TONE[result.temperature] ?? 'slate'}>
          {result.temperature === 'READY_TO_ACT' ? '🔥 ready to act' : result.temperature.toLowerCase()}
        </Badge>
        <span className="lf-num" style={{ fontSize: 'var(--lf-text-xl)', fontWeight: 700 }}>
          {result.score}/100
        </span>
        <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-ink-3)' }}>lead currently {leadScore}</span>
      </div>

      <ul
        style={{ margin: 0, paddingLeft: 'var(--lf-space-4)', fontSize: 'var(--lf-text-sm)', color: 'var(--lf-ink-2)' }}
      >
        {result.reasons.map((reason, i) => (
          <li key={i}>
            <span
              className="lf-num"
              style={{
                fontWeight: 600,
                color: reason.delta >= 0 ? 'var(--lf-viridian, #16a34a)' : 'var(--lf-vermillion, #dc2626)',
              }}
            >
              {reason.delta > 0 ? '+' : ''}
              {reason.delta}
            </span>{' '}
            {reason.text}
          </li>
        ))}
      </ul>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 'var(--lf-space-3)' }}>
        {applied ? (
          <span style={{ fontSize: 'var(--lf-text-sm)', color: 'var(--lf-viridian, #16a34a)' }}>
            Applied to the lead, with the reasons recorded.
          </span>
        ) : canApply ? (
          <button type="button" className="lf-btn lf-btn--sm" onClick={apply} disabled={busy}>
            {busy ? 'Applying…' : `Set lead score to ${result.score}`}
          </button>
        ) : null}
        {error && <span style={{ fontSize: 'var(--lf-text-xs)', color: 'var(--lf-vermillion)' }}>{error}</span>}
      </div>
    </section>
  );
}
