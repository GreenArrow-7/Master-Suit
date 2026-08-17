import { describe, it, expect } from 'vitest';
import { socialSlaState, minutesRemaining, SOCIAL_SLA_DEFAULT_MINUTES } from '@/services/social/sla';

/**
 * The SLA rules, without a database.
 *
 * `socialSlaState` is pure on purpose: the state a manager sees, the Overdue
 * tab's SQL and the escalation job's guard all have to agree, and the cheapest
 * way to keep three callers agreeing is for the rule to exist once.
 */
const start = new Date('2026-08-17T10:00:00Z');
const due = new Date('2026-08-17T10:10:00Z');
const base = {
  commentCreatedAt: start,
  slaDueAt: due,
  repliedAt: null,
  // Nothing internal stops the clock; only a real answer does.
  status: 'ASSIGNED',
};

describe('social SLA state', () => {
  it('is on track early in the window', () => {
    expect(socialSlaState(base, new Date('2026-08-17T10:01:00Z'))).toBe('ON_TRACK');
  });

  it('warns once the configured share of the window has gone', () => {
    // 80% of ten minutes is eight.
    expect(socialSlaState(base, new Date('2026-08-17T10:07:59Z'))).toBe('ON_TRACK');
    expect(socialSlaState(base, new Date('2026-08-17T10:08:00Z'))).toBe('AT_RISK');
  });

  it('respects a tenant that warns earlier', () => {
    expect(socialSlaState(base, new Date('2026-08-17T10:05:00Z'), 50)).toBe('AT_RISK');
  });

  it('breaches at the deadline, not a minute after', () => {
    expect(socialSlaState(base, new Date('2026-08-17T10:09:59Z'))).toBe('AT_RISK');
    expect(socialSlaState(base, new Date('2026-08-17T10:10:00Z'))).toBe('BREACHED');
  });

  it('is met by a reply', () => {
    const late = new Date('2026-08-17T11:00:00Z');
    expect(socialSlaState({ ...base, repliedAt: new Date('2026-08-17T10:03:00Z') }, late)).toBe('MET');
  });

  /**
   * Converting is filing, not answering. The person who commented has heard
   * nothing from a CRM record being created, so an enquiry converted in silence
   * is exactly the one that should stay red.
   */
  it('is not met by converting the enquiry to a lead', () => {
    const converted = { ...base, status: 'CONVERTED' };
    expect(socialSlaState(converted, new Date('2026-08-17T11:00:00Z'))).toBe('BREACHED');
  });

  it('pauses rather than breaching what nobody intends to answer', () => {
    const late = new Date('2026-08-17T11:00:00Z');
    expect(socialSlaState({ ...base, status: 'DISMISSED' }, late)).toBe('PAUSED');
    expect(socialSlaState({ ...base, status: 'SPAM' }, late)).toBe('PAUSED');
  });

  it('owes nothing when no deadline was set', () => {
    expect(socialSlaState({ ...base, slaDueAt: null }, new Date('2026-08-17T23:00:00Z'))).toBe('ON_TRACK');
  });

  /**
   * The rule the whole feature turns on. SLA follows the customer's enquiry, not
   * the salesperson's ownership — reassigning at 10:07 does not hand the desk
   * back the seven minutes that already went by.
   */
  it('does not restart when the enquiry changes hands', () => {
    const reassignedAt = new Date('2026-08-17T10:07:00Z');
    const afterReassignment = { ...base, assignedAt: reassignedAt };
    expect(socialSlaState(afterReassignment, new Date('2026-08-17T10:11:00Z'))).toBe('BREACHED');
    // Had the clock restarted at 10:07, the deadline would be 10:17 and this
    // would still read ON_TRACK.
    expect(minutesRemaining(due, new Date('2026-08-17T10:11:00Z'))).toBe(-1);
  });

  it('defaults to a target only for intents worth chasing', () => {
    expect(SOCIAL_SLA_DEFAULT_MINUTES.HIGH).toBe(10);
    expect(SOCIAL_SLA_DEFAULT_MINUTES.MEDIUM).toBe(30);
    expect(SOCIAL_SLA_DEFAULT_MINUTES.LOW).toBeUndefined();
    expect(SOCIAL_SLA_DEFAULT_MINUTES.SPAM).toBeUndefined();
  });
});
