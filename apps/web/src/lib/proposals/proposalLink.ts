import { publicLink } from '@/lib/publicLink';

/**
 * The link a client opens: `/p/{tenantId}.{proposalId}.{signature}`.
 *
 * Derived, not stored — so there is no token column to leak, and rotating
 * WEBHOOK_SIGNING_PEPPER invalidates every outstanding proposal at once. The
 * tenant travels inside the token, which is what lets the unauthenticated
 * lookup be scoped exactly like an authenticated one instead of needing a hole
 * cut in the tenant guard.
 *
 * `proposal` is its own purpose, so a token minted here cannot be replayed
 * against the RSVP, testimonial or listing-image routes, and vice versa.
 */
export const proposalLink = publicLink('proposal', 'p');
