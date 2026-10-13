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
 * The signature component. Completed segments deepen in burgundy as the record
 * advances, so pipeline depth reads peripherally by colour intensity before any
 * label is read. The active segment widens, carries the brass hairline, and holds
 * the SLA countdown — and abandons the wine ramp entirely for brass or vermillion
 * when the SLA turns, which is exactly why those hues were kept off the burgundy
 * ramp in the token layer.
 *
 * Rendered identically on leads, opportunities and tickets.
 *
 * The exits (the TERMINAL categories: lost, junk) sit apart from the ladder
 * (M4-45): a way out is not a step after the win, and a record that took one
 * has not passed the steps before it.
 */
export default function StageRail({ stages, currentKey, slaState = 'ON_TRACK', slaDueAt, compact }: StageRailProps) {
  const current = stages.find((s) => s.key === currentKey) ?? stages[0];
  const isExit = (stage?: RailStage) => !!stage?.category?.startsWith('TERMINAL');
  const ladder = stages.filter((stage) => !isExit(stage));
  const exits = stages.filter(isExit);

  const countdown = useCountdown(slaDueAt);
  const showTimer = !!slaDueAt && (slaState === 'ON_TRACK' || slaState === 'AT_RISK' || slaState === 'BREACHED');

  const rail = (group: RailStage[], label: string, exit: boolean) => {
    const index = current ? group.indexOf(current) : -1;
    const tone = isExit(current) ? ' lf-rail--lost' : current?.category === 'CONVERSION' ? ' lf-rail--terminal' : '';
    return (
      <div
        className={`lf-rail${exit ? ' lf-rail--exits' : ''}${index >= 0 ? tone : ''}`}
        style={compact ? { height: 24 } : undefined}
        role="group"
        aria-label={label}
      >
        {group.map((stage, i) => {
          // Exits are alternatives, never steps passed on the way to another.
          const state = i === index ? 'active' : i < index && !exit ? 'done' : 'pending';
          // Progressive saturation across completed segments.
          const depth = index > 0 ? i / index : 0;
          const style =
            state === 'done'
              ? { background: `color-mix(in oklab, var(--lf-wine-700) ${16 + depth * 44}%, var(--lf-wine-050))` }
              : undefined;

          return (
            <div
              key={stage.key}
              className="lf-rail__seg"
              data-state={state}
              data-sla={
                state === 'active' && slaState !== 'ON_TRACK' && slaState !== 'MET' ? slaState.toLowerCase() : undefined
              }
              style={style}
              title={stage.name}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              {/* An exit is named: it is a choice, not a position. */}
              {state === 'active' || exit ? (
                <span>{stage.name}</span>
              ) : (
                <span className="lf-visually-hidden">{stage.name}</span>
              )}
              {state === 'active' && showTimer && countdown && <span className="lf-rail__timer">{countdown}</span>}
            </div>
          );
        })}
      </div>
    );
  };

  const label = `Stage: ${current?.name ?? currentKey}`;
  if (!exits.length) return rail(stages, label, false);
  return (
    <div className="lf-rails" role="group" aria-label={label}>
      {rail(ladder, 'Pipeline', false)}
      {rail(exits, 'Exits', true)}
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
