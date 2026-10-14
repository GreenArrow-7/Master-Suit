import { afterEach, describe, expect, it, vi } from 'vitest';

import { todayKey } from '@/services/targets/dailyBoard';

/**
 * M3-19: at 100k leads the board took 4-6 s because todayKey built an
 * Intl.DateTimeFormat per row. One formatter per time zone keeps it under 1 s.
 */
describe('todayKey', () => {
  afterEach(() => vi.restoreAllMocks());

  it('builds one formatter per time zone, not one per call', () => {
    const Real = Intl.DateTimeFormat;
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (...args) {
      return new Real(...args);
    } as typeof Real);
    const zone = 'Pacific/Chatham';
    const at = new Date('2026-10-13T20:00:00Z');
    for (let i = 0; i < 1000; i++) todayKey(zone, at);
    expect(todayKey(zone, at)).toBe('2026-10-14');
    expect(spy.mock.calls.filter(([, options]) => options?.timeZone === zone).length).toBeLessThanOrEqual(1);
  });
});
