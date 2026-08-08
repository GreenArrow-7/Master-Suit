import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request Content-Security-Policy with a script nonce.
 *
 * The policy used to live in next.config.ts, which can only emit a fixed header
 * — and a fixed header cannot carry a nonce, so `script-src` was stuck on
 * `'unsafe-inline'`. That is the one directive whose absence makes CSP worth
 * having: with it, any injected `<script>` runs, and the rest of the policy is
 * decoration.
 *
 * A nonce has to be generated per response, which means middleware. Next reads
 * it from the `x-nonce` request header and stamps it onto the framework's own
 * inline bootstrap scripts, so nothing else has to change.
 *
 * `style-src` keeps `'unsafe-inline'`: this codebase styles with the `style`
 * prop throughout, and inline *styles* are not an execution vector.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isProduction = process.env.NODE_ENV === 'production';

  const csp = [
    "default-src 'self'",
    // `strict-dynamic` lets the nonced bootstrap load the chunks it needs
    // without naming every one. Development additionally needs `unsafe-eval`
    // for React Refresh, which is why this is not the same string in both.
    isProduction
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
      : `script-src 'self' 'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval'`,
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
  headers.set('x-nonce', nonce);

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
     */
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
