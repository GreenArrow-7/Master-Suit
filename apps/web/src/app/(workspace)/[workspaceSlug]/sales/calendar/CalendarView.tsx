'use client';

import { useMemo, useState } from 'react';

interface CalendarItem {
  id: string;
  date: string; // ISO
  label: string;
  kind: 'task' | 'activity';
  completed?: boolean;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarView({ items }: { items: CalendarItem[] }) {
  const [offset, setOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Read once at mount, not on every render. `new Date()` in the render body is
  // impure, which made `year`/`month` unstable and cost `byDay` its memoization.
  const [today] = useState(() => new Date());
  const viewDate = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

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
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--lf-space-3)', marginBottom: 'var(--lf-space-4)' }}
      >
        <button
          className="lf-btn lf-btn--sm lf-btn--secondary"
          onClick={() => setOffset((o) => o - 1)}
          aria-label="Previous month"
        >
          &larr;
        </button>
        <h2 className="lf-h2" style={{ margin: 0, minWidth: 200, textAlign: 'center' }}>
          {monthLabel}
        </h2>
        <button
          className="lf-btn lf-btn--sm lf-btn--secondary"
          onClick={() => setOffset((o) => o + 1)}
          aria-label="Next month"
        >
          &rarr;
        </button>
        {offset !== 0 && (
          <button className="lf-btn lf-btn--sm lf-btn--secondary" onClick={() => setOffset(0)}>
            Today
          </button>
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
          const dayItems = day ? byDay.get(day) : undefined;
          const isToday = day === todayKey;
          const isSelected = day != null && String(day) === selectedDay;
          const tasks = dayItems?.filter((x) => x.kind === 'task') ?? [];
          const activities = dayItems?.filter((x) => x.kind === 'activity') ?? [];

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
                    {tasks.map((t) => (
                      <span
                        key={t.id}
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: t.completed ? 'var(--lf-viridian, #16a34a)' : 'var(--lf-brass, #ca8a04)',
                        }}
                      />
                    ))}
                    {activities.map((a) => (
                      <span
                        key={a.id}
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: 'var(--lf-wine-700, #7f1d4e)',
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
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
              {selectedItems.map((item) => (
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--lf-space-2)',
                    fontSize: 'var(--lf-text-sm)',
                    color: 'var(--lf-ink)',
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background:
                        item.kind === 'activity'
                          ? 'var(--lf-wine-700, #7f1d4e)'
                          : item.completed
                            ? 'var(--lf-viridian, #16a34a)'
                            : 'var(--lf-brass, #ca8a04)',
                    }}
                  />
                  <span
                    style={{
                      textTransform: 'uppercase',
                      fontSize: 'var(--lf-text-xs)',
                      color: 'var(--lf-ink-3)',
                      width: 60,
                    }}
                  >
                    {item.kind}
                  </span>
                  {item.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
