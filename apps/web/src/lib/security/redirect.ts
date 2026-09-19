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

/** Long enough for any screen with its filters; short enough not to be a payload. */
const MAX_RETURN_TO = 2048;

/**
 * The sign-in page for someone who was sent away from `path` (plus its query):
 * `/login?next=…`, so signing in can bring them back to the record they opened
 * — a notification, a shared link, an app deep link. Plain `/login` when there is
 * nothing worth returning to.
 */
export function loginPathFor(path: string | null | undefined, search = ''): string {
  const target = `${path ?? ''}${search}`;
  if (!path || safeReturnTo(target, '') === '' || target.length > MAX_RETURN_TO) return '/login';
  if (path === '/login' || path.startsWith('/login/')) return '/login';
  return `/login?next=${encodeURIComponent(target)}`;
}

/**
 * Where a completed sign-in goes: the page the person asked for, or the server's
 * destination.
 *
 * The requested page wins only when all of these hold, so it can never skip a step
 * the server requires or leave the person's own workspaces:
 *  - the server's destination is an ordinary workspace landing (`/{slug}/dashboard`)
 *    — not a forced password change, enrolment, monitoring or the platform console;
 *  - the requested path is same-site (see `safeReturnTo`) and not the sign-in page;
 *  - its first segment is a workspace this account belongs to.
 * The page itself still enforces access; this only decides where to try.
 */
export function signInLanding(
  next: string | null | undefined,
  destination: string,
  workspaceSlugs: readonly string[],
): string {
  if (!next || next.length > MAX_RETURN_TO || /[\r\n]/.test(next)) return destination;
  if (!/^\/[^/?#]+\/dashboard$/.test(destination)) return destination;
  if (safeReturnTo(next, '') === '') return destination;
  const slug = next.slice(1).split(/[/?#]/)[0];
  if (!slug || slug === 'login' || !workspaceSlugs.includes(slug)) return destination;
  return next;
}
