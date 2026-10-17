/**
 * Repeating tasks (audit M8-10). Completing one creates the next, due one
 * interval after the completed one was due.
 *
 * ponytail: three fixed intervals stored in Task.recurrenceRule, not RRULE —
 * add an RRULE parser when someone needs "every second Tuesday".
 */
export const REPEATS = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type Repeat = (typeof REPEATS)[number];

export function nextDue(due: Date, repeat: string): Date | null {
  const next = new Date(due);
  if (repeat === 'DAILY') next.setUTCDate(next.getUTCDate() + 1);
  else if (repeat === 'WEEKLY') next.setUTCDate(next.getUTCDate() + 7);
  else if (repeat === 'MONTHLY') next.setUTCMonth(next.getUTCMonth() + 1);
  else return null;
  return next;
}
