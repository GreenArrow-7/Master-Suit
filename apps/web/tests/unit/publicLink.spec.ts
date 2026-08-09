import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { publicLink } from '@/lib/publicLink';
import { rsvpToken, verifyRsvpToken } from '@/lib/events/rsvpToken';
import { env } from '@/lib/env';

/**
 * The signed-link scheme, which had no test while it was hardcoded to RSVP.
 *
 * The property worth pinning is the one that motivated making it a factory:
 * a link minted for one flow must not open another.
 */
const rsvp = publicLink('rsvp', 'rsvp');
const testimonial = publicLink('testimonial', 'testimonial');

const T = 'cmsda4cwl0082z8lystvpg84l';
const R = 'cmskxpl110002j0ly4ohzgzfy';

describe('signed public links', () => {
  it('round-trips the tenant and record it vouches for', () => {
    expect(rsvp.verify(rsvp.token(T, R))).toEqual({ tenantId: T, recordId: R });
  });

  it('refuses a token minted for a different purpose', () => {
    // The whole reason this is one factory: a testimonial link must not answer
    // somebody's event invitation, and vice versa.
    expect(rsvp.verify(testimonial.token(T, R))).toBeNull();
    expect(testimonial.verify(rsvp.token(T, R))).toBeNull();
  });

  it('refuses a token whose ids were swapped for someone else’s', () => {
    const [, , signature] = rsvp.token(T, R).split('.');
    const forged = `${T}.cmskxssve0005j0lyphs2sp78.${signature}`;
    expect(rsvp.verify(forged)).toBeNull();
  });

  it('refuses a token from another tenant carrying a valid signature shape', () => {
    const [, , signature] = rsvp.token(T, R).split('.');
    expect(rsvp.verify(`cmsda4mr403d4z8lyhzm1b4s2.${R}.${signature}`)).toBeNull();
  });

  it('never throws on rubbish', () => {
    for (const bad of ['', '.', 'a.b', 'a.b.c.d', 'a.b.c', `${T}.${R}.`, 'not a token at all']) {
      expect(rsvp.verify(bad)).toBeNull();
    }
  });

  it('builds a url on the configured origin', () => {
    expect(rsvp.url(T, R)).toBe(`${env.APP_URL.replace(/\/$/, '')}/rsvp/${rsvp.token(T, R)}`);
  });

  it('keeps every RSVP link minted before the scheme was extracted valid', () => {
    // The old implementation signed exactly this string. Outstanding links in
    // people's inboxes must not stop working because the code moved.
    const legacy = createHmac('sha256', env.WEBHOOK_SIGNING_PEPPER)
      .update(`rsvp:${T}:${R}`)
      .digest('base64url')
      .slice(0, 27);

    expect(rsvpToken(T, R)).toBe(`${T}.${R}.${legacy}`);
    expect(verifyRsvpToken(`${T}.${R}.${legacy}`)).toEqual({ tenantId: T, inviteeId: R });
  });
});
