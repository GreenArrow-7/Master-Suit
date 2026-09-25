/**
 * Who may be called again, and who may not.
 *
 * A brokerage's most valuable list is the one it has already paid for. A lead
 * that went cold in March is not the same lead in September: the tenancy ended,
 * the budget moved, the developer launched a cheaper tower. Recycling is putting
 * those back on the floor — with a cooling-off period, so it is not harassment,
 * and a ceiling, so it does not become a treadmill.
 *
 * The rules are here rather than in the service because they are the whole
 * feature. Everything else is a query and an update; this is the part that must
 * be right, and the part a court would ask about.
 */

export interface RecyclePolicy {
  /** Days in a lost stage before a lead may be offered to somebody else. 0 = off. */
  afterDays: number;
  /** Times one lead may be recycled before it is left alone for good. */
  maxTimes: number;
  /** Where a recycled lead comes back to. Null = the pipeline's default stage. */
  returnStageId: string | null;
}

/** Just enough of a Lead to decide. Keeps this callable from a test with a literal. */
export interface RecycleCandidate {
  id: string;
  recycleCount: number;
  doNotCall: boolean;
  consentStatus: string;
  isMerged: boolean;
  duplicateOfId: string | null;
  /** When it entered its current lost stage, from LeadStageHistory. */
  lostAt: Date | null;
}

const DAY_MS = 86_400_000;

export function policyFrom(
  setting: { leadRecycleAfterDays: number; leadRecycleMaxTimes: number; leadRecycleStageId: string | null } | null,
): RecyclePolicy {
  return {
    afterDays: setting?.leadRecycleAfterDays ?? 0,
    maxTimes: setting?.leadRecycleMaxTimes ?? 2,
    returnStageId: setting?.leadRecycleStageId ?? null,
  };
}

/** Whole days elapsed, floored — the same arithmetic the messages quote back. */
export function daysSince(lostAt: Date, now: Date): number {
  return Math.floor((now.getTime() - lostAt.getTime()) / DAY_MS);
}

/**
 * Why this lead may not be recycled, or null if it may be.
 *
 * A string rather than a boolean because the screen shows it. "14 leads are
 * blocked" tells an administrator nothing; "cooling off for 9 more days" tells
 * them to come back next week, and "they asked not to be contacted" tells them
 * to stop asking.
 *
 * The order is deliberate. Consent is checked before everything else, including
 * age: no amount of elapsed time turns a withdrawal into permission, and a
 * reader skimming this function should meet that rule first.
 */
export function blockedReason(lead: RecycleCandidate, policy: RecyclePolicy, now: Date): string | null {
  if (policy.afterDays <= 0) return 'Recycling is switched off for this workspace.';

  // Never, at any age, for any reason. The lead said no to being contacted at
  // all, which is a different answer from "not this property".
  if (lead.doNotCall) return 'They asked not to be called.';
  if (lead.consentStatus === 'WITHDRAWN') return 'They withdrew consent to be contacted.';

  if (lead.isMerged || lead.duplicateOfId) return 'Merged into another lead.';

  if (lead.recycleCount >= policy.maxTimes) {
    return lead.recycleCount === 1
      ? 'Already recycled once, which is this workspace’s limit.'
      : `Already recycled ${lead.recycleCount} times, which is this workspace’s limit.`;
  }

  /**
   * No history row means nothing recorded the lead arriving in this stage —
   * imported at a lost stage, or moved by something that wrote the column
   * directly. Skipped rather than treated as infinitely old: the cooling-off
   * period is the promise this feature makes, and an unknown date cannot be
   * shown to satisfy it.
   */
  if (!lead.lostAt) return 'No record of when it was lost.';

  const elapsed = daysSince(lead.lostAt, now);
  if (elapsed < policy.afterDays) {
    const left = policy.afterDays - elapsed;
    return `Cooling off — ${left} more ${left === 1 ? 'day' : 'days'}.`;
  }

  return null;
}
