import { describe, expect, it } from 'vitest';
import { blockedReason, daysSince, policyFrom, type RecycleCandidate } from '@/lib/leads/recycling';

/**
 * The rules, on their own.
 *
 * These are the whole feature. Everything around them is a query and an update;
 * this is the part that decides whether a person who asked to be left alone gets
 * called again, so it is tested without a database in the way.
 */

const NOW = new Date('2026-09-25T10:00:00Z');

const POLICY = { afterDays: 90, maxTimes: 2, returnStageId: null };

function lead(over: Partial<RecycleCandidate> = {}): RecycleCandidate {
  return {
    id: 'lead_1',
    recycleCount: 0,
    doNotCall: false,
    consentStatus: 'UNKNOWN',
    isMerged: false,
    duplicateOfId: null,
    lostAt: new Date('2026-01-01T10:00:00Z'),
    ...over,
  };
}

describe('policyFrom', () => {
  it('is off when no settings row exists', () => {
    expect(policyFrom(null)).toEqual({ afterDays: 0, maxTimes: 2, returnStageId: null });
  });

  it('reads the workspace values', () => {
    expect(policyFrom({ leadRecycleAfterDays: 45, leadRecycleMaxTimes: 3, leadRecycleStageId: 'stage_x' })).toEqual({
      afterDays: 45,
      maxTimes: 3,
      returnStageId: 'stage_x',
    });
  });
});

describe('daysSince', () => {
  it('floors to whole days', () => {
    expect(daysSince(new Date('2026-09-20T23:00:00Z'), NOW)).toBe(4);
    expect(daysSince(new Date('2026-09-25T09:00:00Z'), NOW)).toBe(0);
  });
});

describe('blockedReason', () => {
  it('lets a long-cold lead through', () => {
    expect(blockedReason(lead(), POLICY, NOW)).toBeNull();
  });

  it('refuses everything when the workspace has it switched off', () => {
    expect(blockedReason(lead(), { ...POLICY, afterDays: 0 }, NOW)).toMatch(/switched off/i);
  });

  /**
   * The rules that matter. A cooling-off period is a courtesy; these two are the
   * difference between a follow-up and a complaint to the regulator.
   */
  it('never recycles somebody who asked not to be called, however long ago', () => {
    const ancient = lead({ doNotCall: true, lostAt: new Date('2019-01-01T00:00:00Z') });
    expect(blockedReason(ancient, POLICY, NOW)).toMatch(/asked not to be called/i);
  });

  it('never recycles somebody who withdrew consent', () => {
    expect(blockedReason(lead({ consentStatus: 'WITHDRAWN' }), POLICY, NOW)).toMatch(/withdrew consent/i);
  });

  it('checks consent before the attempt ceiling, so the honest reason is shown', () => {
    const both = lead({ doNotCall: true, recycleCount: 9 });
    expect(blockedReason(both, POLICY, NOW)).toMatch(/asked not to be called/i);
  });

  it('allows other consent states through', () => {
    for (const consentStatus of ['UNKNOWN', 'GRANTED', 'IMPLIED']) {
      expect(blockedReason(lead({ consentStatus }), POLICY, NOW)).toBeNull();
    }
  });

  it('skips a lead that was merged into another', () => {
    expect(blockedReason(lead({ isMerged: true }), POLICY, NOW)).toMatch(/merged/i);
    expect(blockedReason(lead({ duplicateOfId: 'lead_2' }), POLICY, NOW)).toMatch(/merged/i);
  });

  it('stops at the ceiling rather than at one past it', () => {
    expect(blockedReason(lead({ recycleCount: 1 }), POLICY, NOW)).toBeNull();
    expect(blockedReason(lead({ recycleCount: 2 }), POLICY, NOW)).toMatch(/already recycled 2 times/i);
  });

  it('says "once" rather than "1 times" at a ceiling of one', () => {
    const reason = blockedReason(lead({ recycleCount: 1 }), { ...POLICY, maxTimes: 1 }, NOW);
    expect(reason).toMatch(/already recycled once/i);
  });

  it('counts the days left while a lead is cooling off', () => {
    const lostLastWeek = lead({ lostAt: new Date('2026-09-18T10:00:00Z') });
    expect(blockedReason(lostLastWeek, POLICY, NOW)).toBe('Cooling off — 83 more days.');
  });

  it('says day, not days, on the last one', () => {
    const almost = lead({ lostAt: new Date('2026-06-28T10:00:00Z') });
    expect(blockedReason(almost, POLICY, NOW)).toBe('Cooling off — 1 more day.');
  });

  it('releases the lead on the day the period elapses, not the day after', () => {
    const exactly = lead({ lostAt: new Date('2026-06-27T10:00:00Z') });
    expect(daysSince(exactly.lostAt!, NOW)).toBe(90);
    expect(blockedReason(exactly, POLICY, NOW)).toBeNull();
  });

  /**
   * An imported lead, or one moved by something that wrote the column directly.
   * Skipped rather than treated as infinitely old: the cooling-off period is the
   * promise this feature makes, and an unknown date cannot be shown to keep it.
   */
  it('skips a lead with no record of when it was lost', () => {
    expect(blockedReason(lead({ lostAt: null }), POLICY, NOW)).toMatch(/no record/i);
  });
});
