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
  legalEntity: 'Youhan', // F7: registered legal name
  address: 'Dubai', // F7
  country: 'United Arab Emirates', // F7
  privacyEmail: 'youan3023@gmail.com', // F7
  supportEmail: 'youan3023@gmail.com', // F7
  supportHours: OWNER_TODO, // F7
  hostingProvider: 'Hetzner Online GmbH, Helsinki, Finland (EU)', // F7: hosting provider and region
  backupRetentionDays: OWNER_TODO, // F5: confirmed from backup-status.sh by root
  deletionTargetHours: '24', // approved: operational target for eligible, unblocked requests
  geminiEnabledAtLaunch: 'none', // F6: "none" or the enabled providers
  lastUpdated: '17 September 2026', // the date the owner approves the text
} as const;

export function missingLegalFacts(): string[] {
  return Object.entries(legalFacts)
    .filter(([, value]) => value === OWNER_TODO)
    .map(([key]) => key);
}
