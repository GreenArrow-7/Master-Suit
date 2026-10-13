import { describe, expect, it } from 'vitest';
import { applyDelta, decayDue } from '@/services/leads/scoring';

/**
 * Lead scoring's arithmetic (Lead Eagle audit row M4-11), pinned exactly. A
 * lead starts at its source's points, each logged activity adds its type's
 * `scoreDelta`, and the nightly decay takes a rule's `decayAmount` for every
 * `decayDays` without activity. The writes that apply these are in
 * tests/sales/lead-scoring.spec.ts.
 */
const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);

describe('a score moves by whole points between 0 and 100', () => {
  it('adds and takes away exactly', () => {
    // A Walk-in lead worth 20, then an outbound call (+3) and a meeting (+12).
    expect(applyDelta(20, 3)).toBe(23);
    expect(applyDelta(applyDelta(20, 3), 12)).toBe(35);
    // Fourteen idle days on a 5-point rule, twice.
    expect(applyDelta(applyDelta(35, -5), -5)).toBe(25);
    expect(applyDelta(7, 0)).toBe(7);
  });

  it('never goes past either end', () => {
    expect(applyDelta(98, 12)).toBe(100);
    expect(applyDelta(100, 3)).toBe(100);
    expect(applyDelta(3, -5)).toBe(0);
    expect(applyDelta(0, -5)).toBe(0);
    expect(applyDelta(150, 0)).toBe(100);
    expect(applyDelta(-4, 0)).toBe(0);
  });

  it('rounds a fractional input to whole points', () => {
    expect(applyDelta(10.4, 0)).toBe(10);
    expect(applyDelta(10, 2.5)).toBe(13);
  });
});

describe('the nightly decay takes one step per idle period', () => {
  const lastActivity = at('2026-10-01T09:00:00Z');

  it('is due once the lead has been idle a whole period', () => {
    expect(decayDue(lastActivity, null, new Date(lastActivity.getTime() + 13 * DAY), 14)).toBe(false);
    expect(decayDue(lastActivity, null, new Date(lastActivity.getTime() + 14 * DAY), 14)).toBe(true);
    expect(decayDue(lastActivity, null, new Date(lastActivity.getTime() + 40 * DAY), 14)).toBe(true);
  });

  it('counts the next period from the last step, so a nightly run takes one step per period', () => {
    const step = new Date(lastActivity.getTime() + 14 * DAY);
    expect(decayDue(lastActivity, step, new Date(step.getTime() + DAY), 14)).toBe(false);
    expect(decayDue(lastActivity, step, new Date(step.getTime() + 13 * DAY), 14)).toBe(false);
    expect(decayDue(lastActivity, step, new Date(step.getTime() + 14 * DAY), 14)).toBe(true);
  });

  it('starts again from an activity logged after the last step', () => {
    const step = at('2026-10-15T03:00:00Z');
    const worked = at('2026-10-20T10:00:00Z');
    expect(decayDue(worked, step, new Date(step.getTime() + 14 * DAY), 14)).toBe(false);
    expect(decayDue(worked, step, new Date(worked.getTime() + 14 * DAY), 14)).toBe(true);
  });

  it('allows a run that fires up to an hour early', () => {
    const step = at('2026-10-15T03:00:30Z');
    expect(decayDue(lastActivity, step, at('2026-10-29T03:00:00Z'), 14)).toBe(true);
    expect(decayDue(lastActivity, step, at('2026-10-29T01:59:00Z'), 14)).toBe(false);
  });
});
