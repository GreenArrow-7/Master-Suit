import { describe, expect, it } from 'vitest';
import { isProductSubscriptionUsable } from '@/services/platform/subscriptions';

/**
 * The single rule every surface resolves to. These are the cases that were
 * decided differently in different places before it existed.
 */
const base = {
  state: 'ACTIVE' as const,
  startsAt: new Date('2026-01-01T00:00:00Z'),
  endsAt: null,
  trialEndsAt: null,
  graceEndsAt: null,
};
const now = new Date('2026-06-01T00:00:00Z');
const past = new Date('2026-05-01T00:00:00Z');
const future = new Date('2026-12-01T00:00:00Z');

describe('isProductSubscriptionUsable', () => {
  it('grants an open-ended active product', () => {
    expect(isProductSubscriptionUsable(base, now)).toBe(true);
  });

  it('grants TRIAL and GRACE within their windows', () => {
    expect(isProductSubscriptionUsable({ ...base, state: 'TRIAL', trialEndsAt: future }, now)).toBe(true);
    expect(isProductSubscriptionUsable({ ...base, state: 'GRACE', graceEndsAt: future }, now)).toBe(true);
  });

  it('refuses TRIAL and GRACE past their windows', () => {
    expect(isProductSubscriptionUsable({ ...base, state: 'TRIAL', trialEndsAt: past }, now)).toBe(false);
    expect(isProductSubscriptionUsable({ ...base, state: 'GRACE', graceEndsAt: past }, now)).toBe(false);
  });

  it('refuses CANCELED and SUSPENDED outright', () => {
    expect(isProductSubscriptionUsable({ ...base, state: 'CANCELED' }, now)).toBe(false);
    expect(isProductSubscriptionUsable({ ...base, state: 'SUSPENDED' }, now)).toBe(false);
  });

  it('lets endsAt override an ACTIVE state', () => {
    // The failure this guards: a billing job that never ran, leaving the row
    // ACTIVE while the term the customer paid for has expired.
    expect(isProductSubscriptionUsable({ ...base, state: 'ACTIVE', endsAt: past }, now)).toBe(false);
    expect(isProductSubscriptionUsable({ ...base, state: 'ACTIVE', endsAt: future }, now)).toBe(true);
  });

  it('refuses a product whose term has not started', () => {
    expect(isProductSubscriptionUsable({ ...base, startsAt: future }, now)).toBe(false);
  });

  it('treats the exact expiry instant as expired', () => {
    expect(isProductSubscriptionUsable({ ...base, endsAt: now }, now)).toBe(false);
  });

  it('ignores currentPeriodEnd, which is a billing anchor and not a gate', () => {
    // Passing an unrelated field must not change the answer: renewal moves
    // currentPeriodEnd, and a customer with an invoice due still has access.
    expect(isProductSubscriptionUsable({ ...base, endsAt: null, trialEndsAt: past, graceEndsAt: past }, now)).toBe(
      true,
    );
  });
});
