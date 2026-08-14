'use client';

import { useMemo, useState } from 'react';
import SalesLink from '@/components/workspace/SalesLink';

interface CalendarItem {
  id: string;
  date: string; // ISO
  label: string;
  kind: 'task' | 'activity' | 'follow-up' | 'call' | 'event';
  completed?: boolean;
  href?: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const KIND_COLOR: Record<CalendarItem['kind'], string> = {
  task: 'var(--lf-brass, #ca8a04)',
  activity: 'var(--lf-wine-700, #7f1d4e)',
  'follow-up': 'var(--lf-teal, #0d9488)',
  call: 'var(--lf-plum, #7c3aed)',
  event: 'var(--lf-sky, #0369a1)',
};

function dotColor(item: CalendarItem): string {
  if (item.completed) return 'var(--lf-viridian, #16a34a)';
  return KIND_COLOR[item.kind];
}

/**
 * Month grid over the items the server fetched for `year`/`month`. Month
 * navigation is URL-driven (`?month=YYYY-MM`) so each arrow re-queries the
 * server, survives refresh and supports direct links; only the day-detail
 * selection lives client-side.
 */
export default function CalendarView({
  items,
  year,
  month,
  prevHref,
  nextHref,
  todayHref,
}: {
  items: CalendarItem[];
  year: number;
  month: number;
  prevHref: string;
  nextHref: string;
  todayHref: string | null;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [today] = useState(() => new Date());

  const viewDate = new Date(year, month, 1);
  const monthLabel = viewDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = new Date(year, month, 1).getDay();

  const byDay = useMemo(() => {
    const map = new Map<number, CalendarItem[]>();
    for (const item of items) {
      const d = new Date(item.date);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        if (!map.has(day)) map.set(day, []);
        map.get(day)!.push(item);
      }
    }
    return map;
  }, [items, year, month]);

  const todayKey = today.getFullYear() === year && today.getMonth() === month ? today.getDate() : -1;

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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 1,
          background: 'var(--lf-ink-4, #e2e8f0)',
          border: '1px solid var(--lf-ink-4, #e2e8f0)',
          borderRadius: 'var(--lf-radius, 8px)',
          overflow: 'hidden',
        }}
      >
        {DAYS.map((d) => (
          <div
            key={d}
            style={{
              padding: 'var(--lf-space-2)',
              fontSize: 'var(--lf-text-xs)',
              fontWeight: 600,
              textAlign: 'center',
              background: 'var(--lf-surface-2, #f8fafc)',
              color: 'var(--lf-ink-3)',
            }}
          >
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          const dayItems = day ? (byDay.get(day) ?? []) : [];
          const isToday = day === todayKey;
          const isSelected = day != null && String(day) === selectedDay;

          return (
            <div
              key={i}
              onClick={() => day && setSelectedDay(isSelected ? null : String(day))}
              style={{
                minHeight: 64,
                padding: 'var(--lf-space-1)',
                background: isSelected ? 'var(--lf-wine-50, #fdf2f4)' : 'var(--lf-surface, #fff)',
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
                      background: isToday ? 'var(--lf-wine-700, #7f1d4e)' : 'transparent',
                      color: isToday ? '#fff' : 'var(--lf-ink)',
                    }}
                  >
                    {day}
                  </div>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
                    {dayItems.map((item) => (
                      <span
                        key={item.id}
                        title={item.label}
                        style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor(item) }}
                      />
                    ))}
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
        {(Object.keys(KIND_COLOR) as CalendarItem['kind'][]).map((kind) => (
          <span key={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: KIND_COLOR[kind] }} />
            {kind === 'follow-up' ? 'Follow-up' : kind[0].toUpperCase() + kind.slice(1)}
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--lf-viridian, #16a34a)' }} />
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
                      {item.kind}
                    </span>
                    <span>
                      {new Date(item.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
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
