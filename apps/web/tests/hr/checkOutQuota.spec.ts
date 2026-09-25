import { describe, expect, it } from 'vitest';
import {
  GATEABLE_METRICS,
  enforcedMetrics,
  isGateable,
  quotaVerdict,
  type QuotaPolicy,
  type QuotaRow,
} from '@/lib/hr/checkOutQuota';

/**
 * Whether somebody may go home.
 *
 * Tested without a database because that is what this decides, and the two
 * rules that matter — no gating on outcomes, and a ceiling on the day — are
 * the ones a reviewer should be able to check by reading one file.
 */

const ON: QuotaPolicy = {
  requireTargetsBeforeCheckOut: true,
  checkOutQuotaMetrics: ['CALLS_ATTEMPTED'],
  checkOutQuotaMaxHours: 10,
};

const row = (over: Partial<QuotaRow> = {}): QuotaRow => {
  const target = over.target ?? 100;
  const achieved = over.achieved ?? 40;
  return { metric: 'CALLS_ATTEMPTED', target, achieved, remaining: Math.max(0, target - achieved), ...over };
};

describe('which targets may hold somebody back', () => {
  it('offers only effort, never outcome', () => {
    expect([...GATEABLE_METRICS].sort()).toEqual(
      ['CALLS_ATTEMPTED', 'CALLS_CONNECTED', 'FOLLOWUPS_COMPLETED', 'INVITATIONS_SENT'].sort(),
    );
    for (const outcome of ['LEADS_CONVERTED', 'LEADS_QUALIFIED', 'LEADS_ASSIGNED', 'RSVPS_CONFIRMED']) {
      expect(isGateable(outcome)).toBe(false);
    }
  });

  it('enforces nothing while the workspace has it switched off', () => {
    expect(enforcedMetrics({ ...ON, requireTargetsBeforeCheckOut: false })).toEqual([]);
  });

  it('drops a configured metric that is not allowed to gate', () => {
    const policy = { ...ON, checkOutQuotaMetrics: ['CALLS_ATTEMPTED', 'LEADS_CONVERTED'] };
    expect(enforcedMetrics(policy)).toEqual(['CALLS_ATTEMPTED']);
  });

  /**
   * The stored value is a free-form string array, so anything that writes it may
   * spell it in lower case. Enforcing nothing because of that would look exactly
   * like the feature being off.
   */
  it('matches whatever case it was stored in', () => {
    expect(enforcedMetrics({ ...ON, checkOutQuotaMetrics: [' calls_attempted '] })).toEqual(['CALLS_ATTEMPTED']);
  });

  it('does not list the same metric twice', () => {
    const policy = { ...ON, checkOutQuotaMetrics: ['CALLS_ATTEMPTED', 'calls_attempted'] };
    expect(enforcedMetrics(policy)).toEqual(['CALLS_ATTEMPTED']);
  });
});

describe('the verdict', () => {
  it('lets somebody go when there is no target at all', () => {
    expect(quotaVerdict([], 120, ON)).toMatchObject({ blocked: false, message: '' });
  });

  it('lets somebody go when the target is met', () => {
    expect(quotaVerdict([row({ achieved: 100 })], 120, ON)).toMatchObject({ blocked: false });
  });

  it('lets somebody go when they overshot', () => {
    expect(quotaVerdict([row({ achieved: 140 })], 120, ON)).toMatchObject({ blocked: false });
  });

  it('refuses with a number they can act on', () => {
    const verdict = quotaVerdict([row({ achieved: 82 })], 120, ON);
    expect(verdict.blocked).toBe(true);
    expect(verdict.message).toBe('18 more calls before you can check out.');
  });

  it('says call, not calls, on the last one', () => {
    expect(quotaVerdict([row({ achieved: 99 })], 120, ON).message).toBe('1 more call before you can check out.');
  });

  it('names every outstanding target, not just the first', () => {
    const verdict = quotaVerdict(
      [row({ achieved: 90 }), row({ metric: 'FOLLOWUPS_COMPLETED', target: 20, achieved: 15 })],
      120,
      ON,
    );
    expect(verdict.message).toBe('10 more calls and 5 more follow-ups before you can check out.');
  });

  it('does not mention a target that is already met', () => {
    const verdict = quotaVerdict(
      [row({ achieved: 100 }), row({ metric: 'FOLLOWUPS_COMPLETED', target: 20, achieved: 15 })],
      120,
      ON,
    );
    expect(verdict.message).toBe('5 more follow-ups before you can check out.');
  });

  /**
   * The rule that keeps this a target rather than a trap. An attendance gate
   * with no end records unpaid — and past the statutory day, unlawful — hours.
   */
  it('stops holding anybody once the day has run long enough', () => {
    const verdict = quotaVerdict([row({ achieved: 10 })], 10 * 60, ON);
    expect(verdict.blocked).toBe(false);
    expect(verdict.releasedByHours).toBe(true);
    expect(verdict.message).toBe('Checked out with 90 more calls outstanding, after 10 hours.');
  });

  it('still holds at one minute before the ceiling', () => {
    expect(quotaVerdict([row({ achieved: 10 })], 10 * 60 - 1, ON)).toMatchObject({
      blocked: true,
      releasedByHours: false,
    });
  });

  it('holds when there is no open check-in to measure from', () => {
    expect(quotaVerdict([row({ achieved: 10 })], null, ON)).toMatchObject({ blocked: true });
  });

  it('honours a shorter ceiling', () => {
    expect(quotaVerdict([row({ achieved: 10 })], 5 * 60, { ...ON, checkOutQuotaMaxHours: 4 })).toMatchObject({
      blocked: false,
      releasedByHours: true,
    });
  });
});
