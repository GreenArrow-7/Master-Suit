import { mergeWhere } from '@/lib/api/where';
import { parseTypedDate } from '@/lib/dates';
import { FOLLOW_UP_KINDS, type FollowUpKind } from '@/lib/leads/callLog';
import { dayBounds, todayKey } from '@/services/targets/dailyBoard';

export { FOLLOW_UP_KINDS, FOLLOW_UP_KIND_LABELS, type FollowUpKind } from '@/lib/leads/callLog';

export const isFollowUpKind = (value: string | undefined): value is FollowUpKind =>
  (FOLLOW_UP_KINDS as readonly string[]).includes(value ?? '');

/** A follow-up still to do, as the Follow-ups list shows it. */
export const OPEN_FOLLOW_UP = { status: { in: ['OPEN', 'IN_PROGRESS', 'RESCHEDULED'] } } as const;

/**
 * A real calendar day as `YYYY-MM-DD`: not "2026-02-31", which `dayBounds` would
 * roll into March, nor "2026-00-10" or "0000-01-01", on which it throws.
 */
export const isDayKey = (value: string | undefined): value is string => !!value && parseTypedDate(value) === value;

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
/**
 * Every follow-up somebody is late on, as one predicate.
 *
 * Open **and** overdue, which are two separate conditions that every caller was
 * re-stating and the landing page was getting wrong in both directions at once:
 * it counted `dueAt < new Date()` (so a follow-up due at 09:00 counted as
 * overdue from 09:01, while the list its chip opened would not call it overdue
 * until tomorrow) and it left `RESCHEDULED` out of "open" — the one status
 * `OPEN_STATUSES` exists to warn about, since moving a date stamps it, so the
 * obligations most likely to be late were the ones missing from the count.
 *
 * There is a second, legitimate meaning of overdue in this codebase: `stateOf`
 * (services/leads/nextFollowUp.ts) asks "is this late *right now*" for one
 * lead's own row, and tasks ask the same of `Task.dueAt`. Those are a different
 * question from "what is on my overdue queue today" and are deliberately left
 * alone. Anything that counts follow-ups, or lists them, uses this.
 */
export const overdueFollowUpsWhere = (timeZone: string, now = new Date()): Record<string, unknown> =>
  mergeWhere(OPEN_FOLLOW_UP, followUpDueWhere({ due: 'overdue' }, timeZone, now));

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
