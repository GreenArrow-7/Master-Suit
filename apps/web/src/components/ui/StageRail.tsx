'use client';

import { useEffect, useState } from 'react';

export type SlaState = 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'MET' | 'PAUSED';

export interface RailStage {
  key: string;
  name: string;
  category?: 'OPEN' | 'CONVERSION' | 'TERMINAL_NEGATIVE' | 'TERMINAL_JUNK';
}

export interface StageRailProps {
  stages: RailStage[];
  currentKey: string;
  slaState?: SlaState;
  slaDueAt?: string | Date | null;
  compact?: boolean;
}

/**
 * The signature component. Completed segments deepen in burgundy as the record
 * advances, so pipeline depth reads peripherally by colour intensity before any
 * label is read. The active segment widens, carries the brass hairline, and holds
 * the SLA countdown — and abandons the wine ramp entirely for brass or vermillion
 * when the SLA turns, which is exactly why those hues were kept off the burgundy
 * ramp in the token layer.
 *
 * Rendered identically on leads, opportunities and tickets.
 */
export default function StageRail({ stages, currentKey, slaState = 'ON_TRACK', slaDueAt, compact }: StageRailProps) {
  const index = Math.max(stages.findIndex((s) => s.key === currentKey), 0);
  const current = stages[index];
  const terminal = current?.category === 'CONVERSION' ? 'terminal'
    : current?.category?.startsWith('TERMINAL') ? 'lost' : null;

  const countdown = useCountdown(slaDueAt);
  const showTimer = !!slaDueAt && (slaState === 'ON_TRACK' || slaState === 'AT_RISK' || slaState === 'BREACHED');

  return (
    <div
      className={`lf-rail${terminal === 'terminal' ? ' lf-rail--terminal' : terminal === 'lost' ? ' lf-rail--lost' : ''}`}
      style={compact ? { height: 24 } : undefined}
      role="group"
      aria-label={`Stage: ${current?.name ?? currentKey}`}
    >
      {stages.map((stage, i) => {
        const state = i < index ? 'done' : i === index ? 'active' : 'pending';
        // Progressive saturation across completed segments.
        const depth = index > 0 ? i / index : 0;
        const style = state === 'done'
          ? { background: `color-mix(in oklab, var(--lf-wine-700) ${16 + depth * 44}%, var(--lf-wine-050))` }
          : undefined;

        return (
          <div
            key={stage.key}
            className="lf-rail__seg"
            data-state={state}
            data-sla={state === 'active' && slaState !== 'ON_TRACK' && slaState !== 'MET' ? slaState.toLowerCase() : undefined}
            style={style}
            title={stage.name}
            aria-current={state === 'active' ? 'step' : undefined}
          >
            {state === 'active' ? (
              <>
                <span>{stage.name}</span>
                {showTimer && countdown && <span className="lf-rail__timer">{countdown}</span>}
              </>
            ) : (
              <span aria-hidden="true">{i < index ? '' : ''}</span>
            )}
            <span className="sr-only" style={SR_ONLY}>{stage.name}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Ticks once a second, but only while the deadline is inside 24 h — a countdown
 *  that re-renders a 30-day timer every second is pure battery cost. */
function useCountdown(due?: string | Date | null): string | null {
  const [, tick] = useState(0);
  const target = due ? new Date(due).getTime() : null;

  useEffect(() => {
    if (!target) return;
    const remaining = target - Date.now();
    if (Math.abs(remaining) > 86_400_000) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!target) return null;
  const diff = target - Date.now();
  const overdue = diff < 0;
  const s = Math.floor(Math.abs(diff) / 1000);
  const d = Math.floor(s / 86400);

  if (d >= 1) return `${overdue ? '+' : ''}${d}d`;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${overdue ? '+' : ''}${hh}:${mm}:${ss}`;
}

const SR_ONLY: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};
