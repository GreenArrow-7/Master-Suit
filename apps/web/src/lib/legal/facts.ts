/**
 * The business facts the public privacy and support pages state.
 *
 * One place, so the pages cannot drift from each other, and so a reviewer can see at a
 * glance what the owner has confirmed and what they have not. Every value is either
 * derived from the code (and says so) or supplied by the owner. Neither page renders
 * while any OWNER_TODO remains — a policy that says "OWNER_TODO" is worse than none,
 * and the store listing links here.
 */
export const OWNER_TODO = 'OWNER_TODO';

export const legalFacts = {
  legalEntity: OWNER_TODO, // F7: registered legal name
  address: OWNER_TODO, // F7
  country: OWNER_TODO, // F7
  privacyEmail: OWNER_TODO, // F7
  supportEmail: OWNER_TODO, // F7
  supportHours: OWNER_TODO, // F7
  hostingProvider: OWNER_TODO, // F7: hosting provider and region
  backupRetentionDays: OWNER_TODO, // F5: confirmed from backup-status.sh by root
  deletionTargetHours: '24', // approved: operational target for eligible, unblocked requests
  geminiEnabledAtLaunch: OWNER_TODO, // F6: "none" or the enabled providers
  lastUpdated: OWNER_TODO, // the date the owner approves the text
} as const;

export function missingLegalFacts(): string[] {
  return Object.entries(legalFacts)
    .filter(([, value]) => value === OWNER_TODO)
    .map(([key]) => key);
}
