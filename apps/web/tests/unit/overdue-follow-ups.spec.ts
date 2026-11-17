/**
 * One meaning of "overdue" for everything that counts or lists follow-ups.
 *
 * Pure functions, no database. The landing page had its own predicate and it
 * was wrong in both directions at once, which is the sort of defect a count
 * never reveals: the chip said one number and the list it opened showed
 * another, and whichever you believed, the difference was invisible.
 *
 * Two independent errors, and they pull opposite ways:
 *
 *   * `dueAt < new Date()` — a follow-up due at 09:00 counted as overdue from
 *     09:01, while the Follow-ups list would not call it overdue until the day
 *     had passed. **Over-counts.**
 *   * `status in (OPEN, IN_PROGRESS)` — moving a follow-up's date stamps it
 *     `RESCHEDULED`, so the obligations most likely to be late were the ones
 *     left out of the count. **Under-counts.**
 *
 * Each test below fails on the old predicate.
 */
import { describe, it, expect } from 'vitest';
import { followUpDueWhere, overdueFollowUpsWhere, OPEN_FOLLOW_UP } from '@/lib/leads/followUpDue';
import { dayBounds, todayKey } from '@/services/targets/dailyBoard';

/** The workspace this product is sold into. UTC+4, so a UTC server is behind it. */
const DUBAI = 'Asia/Dubai';

/** 09:01 Dubai on 16 Nov 2026 — one minute past a 09:00 follow-up. */
const NOW = new Date('2026-11-16T05:01:00Z');

const statuses = (where: Record<string, unknown>) =>
  ((where.status as { in?: string[] } | undefined)?.in ?? []).slice().sort();

const dueBound = (where: Record<string, unknown>) => (where.dueAt as { lt?: Date }).lt;

describe('the overdue follow-up predicate', () => {
  it('counts a rescheduled follow-up, which is the one most likely to be late', () => {
    // Fails on `status: { in: ['OPEN', 'IN_PROGRESS'] }`.
    expect(statuses(overdueFollowUpsWhere(DUBAI, NOW))).toEqual(['IN_PROGRESS', 'OPEN', 'RESCHEDULED']);
    expect(statuses(overdueFollowUpsWhere(DUBAI, NOW))).toEqual(statuses(OPEN_FOLLOW_UP));
  });

  it('does not call a follow-up due earlier today overdue', () => {
    const bound = dueBound(overdueFollowUpsWhere(DUBAI, NOW))!;
    const nineAm = new Date('2026-11-16T05:00:00Z'); // 09:00 Dubai, already past
    // Fails on `dueAt: { lt: new Date() }`, which would include it.
    expect(nineAm.getTime()).toBeGreaterThanOrEqual(bound.getTime());
    expect(bound.getTime()).toBeLessThan(NOW.getTime());
  });

  it('starts the day on the workspace clock, not the server one', () => {
    const bound = dueBound(overdueFollowUpsWhere(DUBAI, NOW))!;
    // Midnight Dubai on the 16th is 20:00 UTC on the 15th.
    expect(bound.toISOString()).toBe('2026-11-15T20:00:00.000Z');
    expect(bound.getTime()).toBe(dayBounds(todayKey(DUBAI, NOW), DUBAI).from.getTime());
  });

  it('gives a different boundary in a different zone, from the same instant', () => {
    const dubai = dueBound(overdueFollowUpsWhere(DUBAI, NOW))!;
    const utc = dueBound(overdueFollowUpsWhere('UTC', NOW))!;
    expect(dubai.getTime()).not.toBe(utc.getTime());
  });

  it('is exactly what the Follow-ups list composes, so a chip and its list agree', () => {
    // The list does OPEN_FOLLOW_UP + followUpDueWhere(params, tz); anything
    // that counts must not re-state that by hand.
    expect(overdueFollowUpsWhere(DUBAI, NOW)).toEqual({
      ...OPEN_FOLLOW_UP,
      ...followUpDueWhere({ due: 'overdue' }, DUBAI, NOW),
    });
  });

  it('leaves the other two meanings of overdue alone', () => {
    // `stateOf` and the task predicates ask "is this late right now", which is
    // a different question. This test records that the difference is intended:
    // if someone unifies them, they should have to delete this.
    const queueBound = dueBound(overdueFollowUpsWhere(DUBAI, NOW))!;
    expect(queueBound.getTime()).toBeLessThan(NOW.getTime());
  });
});
