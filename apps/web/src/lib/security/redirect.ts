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

/**
 * Whether the forced-password gate should send this request to the security
 * screen, given the path it is already on.
 *
 * `here` comes from the `x-pathname` header the proxy stamps, and the only
 * honest answer when it is missing is "do not know". Redirecting on "do not
 * know" is what blanked the application: the security screen itself came
 * through with no header, the gate could not see it was already there, and sent
 * it to itself. The router follows a redirect to the page it is loading,
 * receives the same redirect, and ends with nothing rendered.
 *
 * So an unknown location never redirects. Nothing is let through by that: a
 * request the layout renders without the header is one the proxy did not see,
 * and the proxy now sees every request that is not a static file.
 */
/**
 * `target` is where the gate would send this request. Passing it makes the last
 * clause below possible, and that clause is the one that cannot be reasoned
 * wrong: a redirect to the page currently being served is an infinite loop, no
 * matter what the suffix test made of the path.
 *
 * It is here because this loop happened again in production on
 * `/<workspace>/profile/security` — two dozen identical RSC requests, the app
 * blank, nothing in the server log — and it was not reproducible on the same
 * commit, the same account state (ordinary member, one workspace, forced
 * password) or a production build. Clearing the forced-password state stopped
 * it, which places it in this gate; the mechanism was never found, because the
 * evidence that would have named it is a response body that only exists while
 * the loop is running.
 *
 * So the suffix test is no longer the only thing standing between a bad path and
 * an unusable application. The path is normalised first — a query, a fragment or
 * a trailing slash made `endsWith` answer false on a path that ends in exactly
 * what it is looking for — and then the self-redirect is refused outright. That
 * is hardening, not a diagnosis, and it is deliberately not written as one.
 */
export function needsPasswordChangeRedirect(here: string | null | undefined, target?: string): boolean {
  if (!here) return false;
  const bare = (path: string) => path.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  const at = bare(here);
  if (at.endsWith('/profile/security') || at.endsWith('/people/security')) return false;
  if (target && bare(target) === at) return false;
  return true;
}
