'use client';

import { useMemo, useState } from 'react';
import SalesLink from '@/components/workspace/SalesLink';

interface CalendarItem {
  id: string;
  date: string; // ISO
  /** YYYY-MM-DD on the workspace's clock: the cell the item sits in. */
  day: string;
  label: string;
  kind: 'task' | 'activity' | 'follow-up' | 'call' | 'event' | 'visit';
  completed?: boolean;
  href?: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Theme tokens only: three of these named tokens that never existed, so their
// literal fallbacks drew the same dots in the dark theme.
const KIND_COLOR: Record<CalendarItem['kind'], string> = {
  task: 'var(--lf-brass)',
  activity: 'var(--lf-wine-700)',
  'follow-up': 'var(--lf-info)',
  call: 'var(--lf-slate)',
  event: 'var(--lf-wine-300)',
  visit: 'var(--lf-ink)',
};

const KIND_LABEL: Record<CalendarItem['kind'], string> = {
  task: 'Task',
  activity: 'Activity',
  'follow-up': 'Follow-up',
  call: 'Call',
  event: 'Event',
  visit: 'Site visit',
};

/** Dots a day's cell draws of one kind; past it, one "+N" for the rest (the day's list has them all). */
const DOTS_PER_KIND = 3;

function dotColor(item: CalendarItem): string {
  if (item.completed) return 'var(--lf-viridian)';
  return KIND_COLOR[item.kind];
}

/**
 * Month grid over the items the server fetched for `year`/`month`. Month
 * navigation is URL-driven (`?month=YYYY-MM`) so each arrow re-queries the
 * server, survives refresh and supports direct links; only the day-detail
 * selection lives client-side. Days and times are the workspace's
 * (`timeZone`), as the server placed them, not the browser's.
 */
export default function CalendarView({
  items,
  year,
  month,
  today,
  timeZone,
  prevHref,
  nextHref,
  todayHref,
}: {
  items: CalendarItem[];
  year: number;
  month: number;
  /** YYYY-MM-DD, the workspace's today. */
  today: string;
  timeZone: string;
  prevHref: string;
  nextHref: string;
  todayHref: string | null;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const viewDate = new Date(year, month, 1);
  const monthLabel = viewDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = new Date(year, month, 1).getDay();
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

  const byDay = useMemo(() => {
    const map = new Map<number, CalendarItem[]>();
    for (const item of items) {
      if (!item.day.startsWith(`${monthKey}-`)) continue;
      const day = Number(item.day.slice(8));
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(item);
    }
    return map;
  }, [items, monthKey]);

  const todayKey = today.startsWith(`${monthKey}-`) ? Number(today.slice(8)) : -1;

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const selectedItems = selectedDay != null ? (byDay.get(Number(selectedDay)) ?? []) : [];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--lf-space-3)',
          marginBottom: 'var(--lf-space-4)',
          flexWrap: 'wrap',
        }}
      >
        <SalesLink className="lf-btn lf-btn--sm lf-btn--secondary" href={prevHref} aria-label="Previous month">
          &larr;
        </SalesLink>
        <h2 className="lf-h2" style={{ margin: 0, minWidth: 200, textAlign: 'center' }}>
          {monthLabel}
        </h2>
        <SalesLink className="lf-btn lf-btn--sm lf-btn--secondary" href={nextHref} aria-label="Next month">
          &rarr;
        </SalesLink>
        {todayHref && (
          <SalesLink className="lf-btn lf-btn--sm lf-btn--secondary" href={todayHref}>
            Today
          </SalesLink>
        )}
      </div>

      {/* A class, not an inline grid: the phone rule that folds inline
          `repeat(n, …)` grids to two columns (redesign-mobile.css) made the
          month two days wide under seven day names. */}
      <div className="lf-cal">
        {DAYS.map((d) => (
          <div
            key={d}
            style={{
              padding: 'var(--lf-space-2)',
              fontSize: 'var(--lf-text-xs)',
              fontWeight: 600,
              textAlign: 'center',
              background: 'var(--lf-surface-2)',
              color: 'var(--lf-ink-3)',
            }}
          >
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          const dayItems = day ? (byDay.get(day) ?? []) : [];
          const drawn = new Map<string, number>();
          const dots = dayItems.filter((item) => {
            drawn.set(item.kind, (drawn.get(item.kind) ?? 0) + 1);
            return drawn.get(item.kind)! <= DOTS_PER_KIND;
          });
          const more = dayItems.length - dots.length;
          const isToday = day === todayKey;
          const isSelected = day != null && String(day) === selectedDay;

          return (
            <div
              key={i}
              onClick={() => day && setSelectedDay(isSelected ? null : String(day))}
              /* Click-only day cells were unreachable from the keyboard: no
                 tab stop, no Enter. Empty leading cells stay inert. */
              role={day ? 'button' : undefined}
              tabIndex={day ? 0 : undefined}
              aria-pressed={day ? isSelected : undefined}
              onKeyDown={(e) => {
                if (day && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  setSelectedDay(isSelected ? null : String(day));
                }
              }}
              style={{
                minHeight: 64,
                padding: 'var(--lf-space-1)',
                background: isSelected ? 'var(--lf-wine-050)' : 'var(--lf-surface)',
                cursor: day ? 'pointer' : 'default',
              }}
            >
              {day && (
                <>
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      lineHeight: '26px',
                      textAlign: 'center',
                      borderRadius: '50%',
                      fontSize: 'var(--lf-text-sm)',
                      fontWeight: isToday ? 700 : 400,
                      background: isToday ? 'var(--lf-wine-700)' : 'transparent',
                      color: isToday ? 'var(--yh-on-primary)' : 'var(--lf-ink)',
                    }}
                  >
                    {day}
                  </div>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
                    {dots.map((item) => (
                      <span
                        key={item.id}
                        title={item.label}
                        style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor(item) }}
                      />
                    ))}
                    {more > 0 && (
                      <span
                        title={`${more} more`}
                        style={{ fontSize: 'var(--lf-text-2xs)', lineHeight: '6px', color: 'var(--lf-ink-3)' }}
                      >
                        {`+${more}`}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 'var(--lf-space-4)',
          flexWrap: 'wrap',
          marginTop: 'var(--lf-space-3)',
          fontSize: 'var(--lf-text-xs)',
          color: 'var(--lf-ink-3)',
        }}
      >
        {/* What this month draws: a Lead Eagle calendar has no events to explain. */}
        {(Object.keys(KIND_COLOR) as CalendarItem['kind'][])
          .filter((kind) => items.some((item) => item.kind === kind))
          .map((kind) => (
            <span key={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: KIND_COLOR[kind] }} />
              {KIND_LABEL[kind]}
            </span>
          ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--lf-viridian)' }} />
          Completed
        </span>
      </div>

      {selectedDay != null && (
        <div className="lf-card" style={{ marginTop: 'var(--lf-space-4)' }}>
          <p className="lf-eyebrow" style={{ marginBottom: 'var(--lf-space-2)' }}>
            {new Date(year, month, Number(selectedDay)).toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
          {selectedItems.length === 0 ? (
            <p style={{ color: 'var(--lf-ink-3)', fontSize: 'var(--lf-text-sm)' }}>Nothing scheduled</p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--lf-space-2)',
              }}
            >
              {selectedItems.map((item) => {
                const row = (
                  <>
                    <span
                      style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: dotColor(item) }}
                    />
                    <span
                      style={{
                        textTransform: 'uppercase',
                        fontSize: 'var(--lf-text-xs)',
                        color: 'var(--lf-ink-3)',
                        width: 76,
                        flexShrink: 0,
                      }}
                    >
                      {KIND_LABEL[item.kind]}
                    </span>
                    <span>
                      {new Date(item.date).toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone,
                      })}
                      {' · '}
                      {item.label}
                    </span>
                  </>
                );
                const rowStyle = {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--lf-space-2)',
                  fontSize: 'var(--lf-text-sm)',
                  color: 'var(--lf-ink)',
                } as const;
                return (
                  <li key={item.id}>
                    {item.href ? (
                      <SalesLink href={item.href} style={{ ...rowStyle, textDecoration: 'none' }}>
                        {row}
                      </SalesLink>
                    ) : (
                      <span style={rowStyle}>{row}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
