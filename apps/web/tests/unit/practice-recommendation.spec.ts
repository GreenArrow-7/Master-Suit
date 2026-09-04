/**
 * The drill picker: pure aggregation over audit criteria and unaddressed
 * playbook objections. No database, no model.
 */
import { describe, it, expect } from 'vitest';
import { weakestArea } from '@/services/shared/practiceRecommendation';

const audit = (scores: Record<string, number>) =>
  Object.entries(scores).map(([label, score]) => ({ label, score, maxScore: 10 }));

describe('weakestArea', () => {
  it('drills the recurring unaddressed objection, named, with reasons', () => {
    const rec = weakestArea(
      [audit({ 'Objection handling': 4, Closing: 8 }), audit({ 'Objection handling': 5, Closing: 9 })],
      new Map([['obj1', { name: 'Price too high', count: 3 }]]),
    )!;
    expect(rec.scenario).toBe('OBJECTION');
    expect(rec.objectionId).toBe('obj1');
    expect(rec.objectionName).toBe('Price too high');
    expect(rec.reasons.join(' ')).toMatch(/unaddressed on 3/);
    expect(rec.reasons.join(' ')).toMatch(/45%/);
  });

  it('picks the lowest mapped criterion when no objection recurs', () => {
    const rec = weakestArea(
      [audit({ Closing: 4, 'Discovery questions': 6 }), audit({ Closing: 5, 'Discovery questions': 7 })],
      new Map(),
    )!;
    expect(rec.scenario).toBe('CLOSE');
    expect(rec.reasons[0]).toMatch(/Closing averaged 45% across 2 audited calls/);
  });

  it('recommends nothing when scores are healthy', () => {
    expect(weakestArea([audit({ Closing: 8 }), audit({ Closing: 9 })], new Map())).toBeNull();
  });

  it('ignores a criterion scored on only one call', () => {
    expect(weakestArea([audit({ Closing: 2 })], new Map())).toBeNull();
  });

  it('ignores a one-off unaddressed objection', () => {
    expect(weakestArea([], new Map([['obj1', { name: 'Price', count: 1 }]]))).toBeNull();
  });
});
