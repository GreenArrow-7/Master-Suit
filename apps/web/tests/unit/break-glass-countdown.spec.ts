/**
 * The break-glass countdown.
 *
 * The API for time-boxed write access into a customer workspace existed long
 * before the console had a button for it — the assessment records the gap as
 * M-4, and its point is that a control which can only be used by calling an
 * endpoint by hand is a control that eventually gets removed.
 *
 * What makes the button honest is the clock on it. A grant self-expires, so the
 * number that matters to whoever holds it is how much is left; this is the
 * function that renders that number, and these are the readings that must never
 * appear on it.
 */
import { describe, it, expect } from 'vitest';
import { remaining } from '@/app/(platform)/platform/workspaces/[workspaceId]/BreakGlass';

const now = Date.parse('2026-08-20T12:00:00Z');
const inSeconds = (seconds: number) => new Date(now + seconds * 1000).toISOString();

describe('remaining', () => {
  it('counts whole minutes', () => {
    expect(remaining(inSeconds(12 * 60), now)).toBe('12 minutes left');
  });

  it('says minute, not minutes, when there is one', () => {
    expect(remaining(inSeconds(60), now)).toBe('1 minute left');
  });

  it('does not round the last minute down to zero', () => {
    // "0 minutes left" reads as expired on a grant that still works, which is
    // the one reading that would make somebody hand back access mid-repair.
    expect(remaining(inSeconds(30), now)).toBe('under a minute left');
    expect(remaining(inSeconds(1), now)).toBe('under a minute left');
  });

  it('says expired at zero and past it, never a negative', () => {
    expect(remaining(inSeconds(0), now)).toBe('expired');
    expect(remaining(inSeconds(-600), now)).toBe('expired');
  });

  it('switches to hours and minutes for the long windows', () => {
    // MAX_GRANT_MINUTES is 240, so four hours is a real reading, and "240
    // minutes left" is not a number anybody converts in their head.
    expect(remaining(inSeconds(240 * 60), now)).toBe('4h 00m left');
    expect(remaining(inSeconds(95 * 60), now)).toBe('1h 35m left');
  });

  it('pads the minutes so the width does not jump every tick', () => {
    expect(remaining(inSeconds(61 * 60), now)).toBe('1h 01m left');
  });
});
