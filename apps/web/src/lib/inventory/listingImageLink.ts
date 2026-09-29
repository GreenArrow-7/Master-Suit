import { publicLink } from '@/lib/publicLink';

/**
 * A listing photograph, fetchable by something with no session.
 *
 * A portal's crawler has no credentials of ours, so the images in a feed have
 * to be reachable without one. The bucket stays private — everything else in
 * this product is served through an authenticated route, and opening it for
 * this would weaken it for the passport scans that live in the same bucket.
 *
 * So the same signed-token mechanism the RSVP and testimonial links use, with
 * its own purpose: the token carries the tenant, so the unauthenticated lookup
 * is scoped exactly like an authenticated one instead of needing an exception
 * carved into the tenant guard.
 *
 * Not expiring, deliberately. A portal fetches the feed on its own schedule
 * and the images later still, sometimes days later, and a link that expires
 * first is a listing that appears with no pictures. Rotating
 * WEBHOOK_SIGNING_PEPPER invalidates every outstanding one at once, which is
 * the lever if a key ever needs pulling.
 */
export const listingImageLink = publicLink('listing-image', 'li');
