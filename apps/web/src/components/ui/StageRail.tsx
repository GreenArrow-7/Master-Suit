'use client';

import { useCallback, useSyncExternalStore } from 'react';

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
 * Stage position, SLA state and the countdown in one 28px strip, rendered the
 * same on a lead, an opportunity and a ticket. Nothing here is saturated and
 * nothing moves: done segments are a neutral step, the active one is the indigo
 * wash at 600, and an at-risk or breached segment sits on its muted semantic
 * ground. `.lf-rail__seg` carries every state, so a segment only declares what
 * it is — no per-segment colour is computed here.
 */
export default function StageRail({ stages, currentKey, slaState = 'ON_TRACK', slaDueAt, compact }: StageRailProps) {
  const index = Math.max(
    stages.findIndex((s) => s.key === currentKey),
    0,
  );
  const current = stages[index];
  const terminal =
    current?.category === 'CONVERSION' ? 'terminal' : current?.category?.startsWith('TERMINAL') ? 'lost' : null;

  const countdown = useCountdown(slaDueAt);
  const showTimer = !!slaDueAt && (slaState === 'ON_TRACK' || slaState === 'AT_RISK' || slaState === 'BREACHED');

  return (
    <div
      className={`lf-rail${terminal === 'terminal' ? ' lf-rail--terminal' : terminal === 'lost' ? ' lf-rail--lost' : ''}`}
      data-compact={compact || undefined}
      role="group"
      aria-label={`Stage: ${current?.name ?? currentKey}`}
    >
      {stages.map((stage, i) => {
        const state = i < index ? 'done' : i === index ? 'active' : 'pending';
        return (
          <div
            key={stage.key}
            className="lf-rail__seg"
            data-state={state}
            data-sla={
              state === 'active' && slaState !== 'ON_TRACK' && slaState !== 'MET' ? slaState.toLowerCase() : undefined
            }
            title={stage.name}
            aria-current={state === 'active' ? 'step' : undefined}
          >
            <span className="lf-rail__name">{stage.name}</span>
            {state === 'active' && showTimer && countdown && <span className="lf-rail__timer">{countdown}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Ticks once a second, but only while the deadline is inside 24 h — a countdown
 *  that re-renders a 30-day timer every second is pure battery cost. */
function useCountdown(due?: string | Date | null): string | null {
  const target = due ? new Date(due).getTime() : null;

  /**
   * The wall clock is an external mutable source, so it is subscribed to rather
   * than read during render. `Date.now()` in the render body is impure, and it
   * also made the server and the client compute two different times, so every
   * countdown hydrated mismatched. The server snapshot is null, so both sides
   * render nothing until the subscription supplies a real reading.
   */
  const subscribe = useCallback(
    (onTick: () => void) => {
      if (!target || Math.abs(target - Date.now()) > 86_400_000) return () => {};
      const id = setInterval(onTick, 1000);
      return () => clearInterval(id);
    },
    [target],
  );

  // Whole seconds: getSnapshot must return an equal value between ticks, or
  // React re-renders in a loop.
  const seconds = useSyncExternalStore<number | null>(
    subscribe,
    () => Math.floor(Date.now() / 1000),
    () => null,
  );

  if (!target || seconds === null) return null;
  const diff = target - seconds * 1000;
  const overdue = diff < 0;
  const s = Math.floor(Math.abs(diff) / 1000);
  const d = Math.floor(s / 86400);

  if (d >= 1) return `${overdue ? '+' : ''}${d}d`;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${overdue ? '+' : ''}${hh}:${mm}:${ss}`;
}
