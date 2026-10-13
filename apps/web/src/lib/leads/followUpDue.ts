import { mergeWhere } from '@/lib/api/where';
import { FOLLOW_UP_KINDS, type FollowUpKind } from '@/lib/leads/callLog';
import { dayBounds, todayKey } from '@/services/targets/dailyBoard';

export { FOLLOW_UP_KINDS, FOLLOW_UP_KIND_LABELS, type FollowUpKind } from '@/lib/leads/callLog';

export const isFollowUpKind = (value: string | undefined): value is FollowUpKind =>
  (FOLLOW_UP_KINDS as readonly string[]).includes(value ?? '');

/** A follow-up still to do, as the Follow-ups list shows it. */
export const OPEN_FOLLOW_UP = { status: { in: ['OPEN', 'IN_PROGRESS', 'RESCHEDULED'] } } as const;

/** A real calendar day as `YYYY-MM-DD`: not "2026-02-31", which `dayBounds` would roll into March. */
export const isDayKey = (value: string | undefined): value is string =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/** The day key `days` after `key` (before, when negative). */
export const shiftDay = (key: string, days: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
};

/** "15 Oct 2026" for a day key: the day itself, whatever the server's zone. */
export const onDay = (
  key: string,
  format: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' },
) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { ...format, timeZone: 'UTC' });

/**
 * `due` (overdue, today, upcoming), `date` (one day) and `kind`, on the
 * workspace's clock: one meaning for the Follow-ups list, its API and the
 * board's tiles, so a tile's link lists what the tile counted. Overdue is due
 * before today began, not before this minute: something due at 09:00 is due
 * today all day. Unknown values are ignored.
 */
export function followUpDueWhere(
  query: { due?: string; date?: string; kind?: string },
  timeZone: string,
  now = new Date(),
): Record<string, unknown> {
  const today = dayBounds(todayKey(timeZone, now), timeZone);
  const day = isDayKey(query.date) ? dayBounds(query.date, timeZone) : null;
  return mergeWhere(
    query.due === 'overdue'
      ? { dueAt: { lt: today.from } }
      : query.due === 'today'
        ? { dueAt: { gte: today.from, lte: today.to } }
        : query.due === 'upcoming'
          ? { dueAt: { gt: today.to } }
          : null,
    day && { dueAt: { gte: day.from, lte: day.to } },
    isFollowUpKind(query.kind) ? { kind: query.kind } : null,
  );
}
