/**
 * Signed links for people who are not logged in.
 *
 * `{tenantId}.{recordId}.{signature}` — the signature covers both ids and the
 * purpose, so the ids alone are worth nothing and a link minted for one flow
 * cannot be replayed against another. That last part is why this is a factory
 * rather than three copies: domain separation done once is domain separation
 * that cannot be forgotten in the third copy.
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
 * nil: a token authenticates one person to one record, so the worst a replay
 * achieves is changing that person's own answer.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

const SIGNATURE_CHARS = 27; // 160 bits of a base64url SHA-256

export interface PublicClaim {
  tenantId: string;
  recordId: string;
}

export interface PublicLink {
  token: (tenantId: string, recordId: string) => string;
  url: (tenantId: string, recordId: string) => string;
  /** What the token vouches for, or null. Never throws on bad input. */
  verify: (token: string) => PublicClaim | null;
}

/**
 * @param purpose domain separator mixed into the signature — never reuse one.
 * @param path    the app route that consumes the token, e.g. `rsvp`.
 */
export function publicLink(purpose: string, path: string): PublicLink {
  const sign = (tenantId: string, recordId: string) =>
    createHmac('sha256', env.WEBHOOK_SIGNING_PEPPER)
      .update(`${purpose}:${tenantId}:${recordId}`)
      .digest('base64url')
      .slice(0, SIGNATURE_CHARS);

  const token = (tenantId: string, recordId: string) => `${tenantId}.${recordId}.${sign(tenantId, recordId)}`;

  return {
    token,
    url: (tenantId, recordId) => `${env.APP_URL.replace(/\/$/, '')}/${path}/${token(tenantId, recordId)}`,
    verify: (supplied: string) => {
      const parts = supplied.split('.');
      if (parts.length !== 3) return null;

      const [tenantId, recordId, signature] = parts;
      if (!tenantId || !recordId || signature.length !== SIGNATURE_CHARS) return null;

      const expected = sign(tenantId, recordId);
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? { tenantId, recordId } : null;
    },
  };
}
