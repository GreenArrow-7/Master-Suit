import { describe, expect, it } from 'vitest';
import { targetStatus } from '@/app/(workspace)/[workspaceSlug]/sales/leadership/DailyBoardView';
import type { DailyBoardRow } from '@/services/targets/dailyBoard';

/**
 * The word beside the percentage, at the boundary where the two disagree.
 *
 * `completion` is rounded, so 199 of 200 leads called is 100% — and the first
 * version of this status read the percentage. It put "Achieved" next to a
 * Pending column of 1, above a check-out the seller was still refused, because
 * the turnstile counts the shortfall and not the rounding. The status now comes
 * from `pending`, which is the figure `dailyTargetShortfall` hands the gate.
 */
const row = (over: Partial<DailyBoardRow>): DailyBoardRow =>
  ({
    userId: 'u1',
    name: 'Seller',
    target: null,
    targetId: null,
    leadsAssigned: 0,
    leadsCalled: 0,
    callsCompleted: 0,
    connected: 0,
    notAnswered: 0,
    cold: 0,
    warm: 0,
    interested: 0,
    followUpsCreated: 0,
    meetingsScheduled: 0,
    opportunitiesCreated: 0,
    dealsWon: 0,
    pending: 0,
    completion: null,
    totalDurationSecs: 0,
    averageDurationSecs: null,
    checkInAt: null,
    checkedOut: false,
    ...over,
  }) as DailyBoardRow;

describe('the daily target status, in words', () => {
  it('says Achieved only when nothing is left to call', () => {
    expect(targetStatus(row({ target: 4, leadsCalled: 4, pending: 0, completion: 100 })).label).toBe('Achieved');
    expect(targetStatus(row({ target: 4, leadsCalled: 2, pending: 2, completion: 50 })).label).toBe('Pending');
  });

  it('does not follow the rounded percentage', () => {
    // 199 of 200 rounds to 100%. One lead is still owed, the check-out gate
    // still refuses, and the word must agree with the gate.
    const nearly = row({ target: 200, leadsCalled: 199, pending: 1, completion: 100 });
    expect(nearly.completion, 'the percentage really does round up').toBe(100);
    expect(targetStatus(nearly).label).toBe('Pending');
    expect(targetStatus(nearly).tone).toBe('brass');
  });

  it('a seller with no target is not failing', () => {
    const none = targetStatus(row({ target: null, leadsAssigned: 6, pending: 6, completion: null }));
    expect(none.label).toBe('No target');
    expect(none.tone).toBe('slate');
  });

  it('a target of zero reads as no target rather than met', () => {
    // dailyBoard leaves `completion` null for a non-positive target, so the row
    // carries a target with no percentage; it must not read as Achieved.
    expect(targetStatus(row({ target: 0, leadsCalled: 0, pending: 0, completion: null })).label).toBe('No target');
  });
});
