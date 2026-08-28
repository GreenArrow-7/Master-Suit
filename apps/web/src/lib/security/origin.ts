import { env } from '../env';
import { Forbidden } from '../errors';

/**
 * Origin checking for state-changing browser requests.
 *
 * ── What the application relies on today ────────────────────────────────────
 *
 * The session cookie is `SameSite=Lax`, `HttpOnly`, and `Secure` in production.
 * Lax is a real CSRF defence: the browser withholds the cookie from cross-site
 * POST, PUT, PATCH and DELETE, so a form on an attacker's page cannot drive an
 * authenticated write. There is no CSRF token scheme anywhere in this codebase,
 * and this file does not add one.
 *
 * ── What this adds, and why only here ───────────────────────────────────────
 *
 * Lax has two known gaps: a browser old enough to predate it sends the cookie
 * anyway, and Lax is enforced per *site*, not per origin — so `evil.example.com`
 * is same-site with `app.example.com` on a shared registrable domain. Comparing
 * the `Origin` header against the configured `APP_URL` closes both, and costs a
 * header read.
 *
 * It is applied to the service-identity endpoints rather than globally on
 * purpose. Turning it on for every route in one change would refuse traffic from
 * any caller that omits `Origin` — server-to-server clients, older integrations,
 * the API-key callers this product ships — and that is a compatibility decision
 * for the whole API, not something to smuggle in alongside a login route. Making
 * it global is a worthwhile follow-up; making it global *silently* would be an
 * outage.
 *
 * ── Deliberately not a replacement for a token ──────────────────────────────
 *
 * An origin check is header-based. It is defeated by anything that can forge
 * request headers, which in a browser means an XSS on the application's own
 * origin — and an XSS already has the session. It raises the bar for
 * cross-origin forgery; it is not a substitute for a synchroniser token if this
 * ever grows a broad authenticated write surface.
 */

/** Requests with no body-changing effect need no check. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function assertSameOrigin(req: Request) {
  if (SAFE_METHODS.has(req.method)) return;

  const stated = req.headers.get('origin');
  /**
   * A missing `Origin` is allowed, and that is not a hole being waved through.
   *
   * Browsers attach it to every cross-origin request and to every same-origin
   * POST; the callers that omit it are non-browsers, which hold no cookie to be
   * ridden in the first place. Refusing on absence would break `curl`, the test
   * suite and every server-to-server client while stopping no attack a browser
   * could mount.
   */
  if (!stated) return;

  let expected: string;
  try {
    expected = new URL(env.APP_URL).origin;
  } catch {
    // A malformed APP_URL must not become an open door. If the expected origin
    // cannot be determined, nothing cross-origin is accepted.
    throw Forbidden('This request could not be verified as same-origin.');
  }

  if (stated !== expected) {
    throw Forbidden('This request came from another origin and was refused.');
  }
}
