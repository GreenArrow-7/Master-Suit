import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request Content-Security-Policy.
 *
 * The policy used to live in next.config.ts, which can only emit a fixed header.
 * Moving it here allows the development and production policies to differ, and
 * adds `upgrade-insecure-requests` where there is TLS to upgrade to.
 *
 * NO NONCE, deliberately, and this is the important part.
 *
 * A nonce was tried first, with `strict-dynamic`, because `'unsafe-inline'` is
 * the directive whose absence makes CSP worth having. Next 16.2.12 does not
 * stamp nonces onto its script tags in a production build: a development server
 * nonced all 29, a production build served 20 with none, whether the nonce was
 * offered via `x-nonce`, via a Content-Security-Policy request header, or from
 * the `proxy` convention rather than `middleware`.
 *
 * That combination is not merely ineffective, it is fatal. A nonce in the policy
 * makes browsers ignore `'unsafe-inline'` entirely, and `strict-dynamic`
 * disables host allowlisting so `'self'` stops applying too — so every chunk and
 * every inline script was blocked and the application rendered server-side and
 * then did nothing. Verified against a real production build: see
 * tests/e2e/csp.spec.ts, which now runs against one.
 *
 * So production keeps `'unsafe-inline'` for scripts and drops `'unsafe-eval'`.
 * That is weaker than intended and is recorded as such — closing it needs either
 * framework support for nonce propagation or a build step that hashes the
 * inline bootstrap.
 *
 * `style-src` keeps `'unsafe-inline'` for a different and benign reason: this
 * codebase styles with the `style` prop throughout, and inline styles are not an
 * execution vector.
 */
export default function proxy(request: NextRequest) {
  const isProduction = process.env.NODE_ENV === 'production';

  const csp = [
    "default-src 'self'",
    // Development also needs `unsafe-eval` for React Refresh; production must
    // not have it.
    isProduction ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Only in production: on localhost there is no TLS to upgrade to, and the
    // directive would break every asset request.
    ...(isProduction ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const headers = new Headers(request.headers);
  // Server components cannot read the request URL. The workspace layout needs
  // it to know whether the viewer is already on the screen it would send them
  // to, so stamp it here where the URL is still in hand.
  headers.set('x-pathname', request.nextUrl.pathname);
  // The query too, so a signed-out visitor sent to sign-in can come back to the
  // same filtered screen, not just the same path.
  headers.set('x-search', request.nextUrl.search);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    /**
     * Everything except static assets and images.
     *
     * Those are served straight from disk and carry no markup, so a policy on
     * them costs a middleware invocation per file and protects nothing.
     *
     * Prefetches are NOT excluded, deliberately.
     *
     * The usual `missing: [next-router-prefetch, purpose=prefetch]` clause was
     * here, so this never ran for a prefetch and `x-pathname` was absent on one.
     * The workspace layout reads that header to tell whether the viewer is
     * already on the screen its forced-password gate would send them to; with
     * the header absent it cannot tell, so it redirected the security screen to
     * itself. The router follows that, gets the same redirect, and gives up —
     * which is a blank page at the right URL with nothing in the server log,
     * because a redirect is not an error.
     *
     * Skipping prefetches also meant a prefetched payload was built without the
     * gate applying at all, so the router could hand back a page the gate exists
     * to keep out of reach.
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
