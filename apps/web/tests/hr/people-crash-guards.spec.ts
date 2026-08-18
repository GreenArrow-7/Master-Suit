import { describe, it, expect } from 'vitest';
import { queryDate, toDay } from '@/services/hr/rules';

/**
 * The People screens take dates straight out of the query string, and
 * `new Date('last-tuesday')` is an Invalid Date rather than an error. It stayed
 * quiet until `toDay()` called `.toISOString()` on it, which throws
 * `RangeError: Invalid time value` — a 500 and "something went wrong on our
 * side" for what is only a mistyped or stale URL.
 */
const fallback = new Date('2026-08-17T00:00:00.000Z');

describe('queryDate', () => {
  it('falls back rather than producing an Invalid Date', () => {
    for (const bad of ['not-a-date', 'last-tuesday', '2026-13-45', 'xyz', '%%%', '']) {
      expect(queryDate(bad, fallback).getTime()).toBe(fallback.getTime());
    }
  });

  it('falls back when the parameter is absent', () => {
    expect(queryDate(undefined, fallback).getTime()).toBe(fallback.getTime());
  });

  it('keeps a date the user actually asked for', () => {
    expect(queryDate('2026-03-04', fallback).toISOString()).toBe('2026-03-04T00:00:00.000Z');
  });

  /**
   * The specific chain that produced the 500: an unreadable value reaching
   * `toDay`, whose `.toISOString()` is what actually threw.
   */
  it('produces something toDay can safely format', () => {
    for (const bad of ['not-a-date', 'last-tuesday', '2026-13-45']) {
      expect(() => toDay(queryDate(bad, fallback)).toISOString()).not.toThrow();
    }
    // And the unguarded form is still the trap this exists to avoid.
    expect(() => toDay(new Date('not-a-date')).toISOString()).toThrow(RangeError);
  });
});
