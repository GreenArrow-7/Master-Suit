/**
 * The credential an invitee holds.
 *
 * `{tenantId}.{inviteeId}.{signature}` — the signature covers both ids, so the
 * ids alone are worth nothing. Before this, the RSVP endpoint took a bare cuid,
 * which meant anyone who guessed or was forwarded one could answer on someone
 * else's behalf.
 *
 * The tenant is **in** the token, and that is not padding. Without it the public
 * lookup would be `findFirst({ where: { id } })` with no tenant filter, which the
 * tenant guard refuses and row-level security returns empty for — so the
 * endpoint would have needed an exception carved into both, weakening them for
 * every other caller. Carrying the tenant means the unauthenticated path is
 * scoped exactly like every authenticated one.
 *
 * Derived rather than stored: rotating WEBHOOK_SIGNING_PEPPER invalidates every
 * outstanding link at once, and there is no column to migrate, index or leak.
 *
 * Not single-use, deliberately. People change their minds, forward the message
 * to a colleague, or open it twice on two phones. A link that dies on first use
 * turns all three into a support request, and the value of single-use here is
 * nil: the token authenticates one invitee to one event, so the worst a replay
 * achieves is changing that invitee's own answer.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

const SIGNATURE_CHARS = 27; // 160 bits of a base64url SHA-256

const sign = (tenantId: string, inviteeId: string) =>
  createHmac('sha256', env.WEBHOOK_SIGNING_PEPPER)
    .update(`rsvp:${tenantId}:${inviteeId}`)
    .digest('base64url')
    .slice(0, SIGNATURE_CHARS);

export const rsvpToken = (tenantId: string, inviteeId: string) =>
  `${tenantId}.${inviteeId}.${sign(tenantId, inviteeId)}`;

export const rsvpUrl = (tenantId: string, inviteeId: string) =>
  `${env.APP_URL.replace(/\/$/, '')}/rsvp/${rsvpToken(tenantId, inviteeId)}`;

export interface RsvpClaim {
  tenantId: string;
  inviteeId: string;
}

/** What the token vouches for, or null. Never throws on bad input. */
export function verifyRsvpToken(token: string): RsvpClaim | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [tenantId, inviteeId, supplied] = parts;
  if (!tenantId || !inviteeId || supplied.length !== SIGNATURE_CHARS) return null;

  const expected = sign(tenantId, inviteeId);
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) ? { tenantId, inviteeId } : null;
}
