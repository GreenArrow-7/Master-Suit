/**
 * Where a redirect is allowed to land.
 *
 * A leading `/` does not keep a URL on this site. `new URL('//evil.example',
 * APP_URL)` resolves to `https://evil.example/` — a protocol-relative URL
 * passes a `startsWith('/')` test and leaves the origin entirely. `/\evil`
 * is the same trick with the other slash, which several parsers normalise to
 * `//`. Both are how a "relative paths only" check is usually defeated.
 *
 * This lives in one place because it was written twice — in the Meta connect
 * route and again in its callback — and both copies had the same hole. A
 * security predicate with two definitions has two chances to be wrong.
 */
const SAME_SITE_PATH = /^\/(?![/\\])/;

/**
 * The caller-supplied path if it is genuinely same-site, otherwise the site
 * root. Never throws: a redirect target is a convenience, and refusing the
 * whole request because somebody bookmarked something odd would be worse than
 * landing them on the dashboard.
 */
export function safeReturnTo(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback;
  return SAME_SITE_PATH.test(value) ? value : fallback;
}
