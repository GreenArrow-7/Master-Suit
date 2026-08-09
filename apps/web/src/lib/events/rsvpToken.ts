/**
 * The credential an invitee holds.
 *
 * The scheme, and the reasoning behind it, now lives in `@/lib/publicLink` —
 * testimonial requests need the same signed link and a second copy of an HMAC
 * scheme is how domain separation gets forgotten. The `rsvp` purpose keeps every
 * token minted before the move valid.
 */
import { publicLink, type PublicClaim } from '@/lib/publicLink';

const link = publicLink('rsvp', 'rsvp');

export const rsvpToken = link.token;
export const rsvpUrl = link.url;

export interface RsvpClaim {
  tenantId: string;
  inviteeId: string;
}

/** What the token vouches for, or null. Never throws on bad input. */
export function verifyRsvpToken(token: string): RsvpClaim | null {
  const claim: PublicClaim | null = link.verify(token);
  return claim && { tenantId: claim.tenantId, inviteeId: claim.recordId };
}
