/**
 * Where the browser goes after a save that has already succeeded.
 *
 * Not `router.push` / `router.refresh`. When an RSC transition cannot produce a
 * payload, Next does not raise an error — it converts the failure into an MPA
 * fallback, and `next/dist/client/components/app-router.js` (16.4.2, the block
 * guarded by `pushRef.mpaNavigation`) calls `location.assign()`/`.replace()`
 * **inside a React render pass** and then `throw unresolvedThenable`:
 *
 *     if (globalMutable.pendingMpaPath !== canonicalUrl) {
 *         location.assign(canonicalUrl)      // or .replace
 *         globalMutable.pendingMpaPath = canonicalUrl;
 *     }
 *     throw _unresolvedthenable.unresolvedThenable;
 *
 * That suspends the whole router subtree with no resolution path — suspending
 * is not an error, so no error boundary renders — and `pendingMpaPath` then
 * blocks any retry to the same URL. The page's content is gone before the GET
 * is even in flight, so a GET that does not commit leaves a blank document at
 * the right URL with no error page and no way out but a new document. That is
 * what "closing and reopening the app shows the updated data" is.
 *
 * One GET, issued from an event handler on a document that is still committed
 * and painted: the current page stays on screen until the new one commits, and
 * if it never commits the document is still live, so `onStuck` can offer a
 * retry the person can tap.
 *
 * It replays nothing (`assign()` issues a GET), clears no session, waits no
 * interval before acting, and cannot loop: it runs only inside a success
 * handler a tap entered, and a GET does not re-enter it.
 */
import { noteDiagnostic } from '@/lib/diagnostics/clientLog';

/** Long enough not to accuse a slow radio; short enough that nobody stares. */
const STUCK_AFTER_MS = 3_500;

/**
 * When the person last tapped a link.
 *
 * A save that reloads the record must never override a person who has already
 * tapped somewhere else — that is precisely the complaint the fix exists to
 * answer ("Save, immediately navigate, the destination renders"), and an
 * unconditional `location.assign` reintroduces it from the other side: the tap
 * is swallowed and they land back on the record they were leaving.
 *
 * Capture phase, so it is seen before any handler can stop propagation.
 */
let lastLinkTapAt = 0;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('a[href]')) lastLinkTapAt = Date.now();
    },
    true,
  );
}

/** Read before a save starts, handed back to `afterSave` when it finishes. */
export function saveStartedAt(): number {
  return Date.now();
}

/** The page we are on now, query kept, so a filtered list comes back filtered. */
export function currentPath(): string {
  return window.location.pathname + window.location.search;
}

/**
 * The destination, refused unless it is a path on this origin.
 *
 * A record id comes from a server response, so `/leads/${id}` is only a
 * same-origin path while the id is one. `//elsewhere.example`,
 * `https://elsewhere.example/x` and `javascript:` all resolve to another (or an
 * opaque) origin and are refused.
 */
export function sameOriginPath(to: string, here: string): string | null {
  let url: URL;
  try {
    url = new URL(to, here);
  } catch {
    return null;
  }
  if (url.origin !== new URL(here).origin) return null;
  // The hash is dropped: nothing routes on it, and carrying one into a fresh
  // document would scroll the new page somewhere arbitrary.
  return url.pathname + url.search;
}

/** An id that came back from a save, only if it can safely become a URL path. */
export function recordPath(base: string, id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (trimmed === '' || !/^[A-Za-z0-9_-]{1,64}$/.test(trimmed)) return null;
  return `${base}/${trimmed}`;
}

/**
 * Go there.
 *
 * The stuck check is armed on every call: if this document has not begun
 * unloading within `STUCK_AFTER_MS`, the navigation is not coming, and that
 * fact is the most valuable thing this change can record — it is what tells us
 * whether a top-level GET commits on that phone at all. It is recorded
 * unconditionally; `onStuck` is only the on-screen surface.
 *
 * It is a failure surface, not a delay: the GET is issued immediately and the
 * timer only decides when to admit it has not landed.
 *
 * Backgrounding the app neither cancels it nor reports it. A phone that
 * backgrounds mid-navigation is routine, and both a false "stuck" line and a
 * silently disarmed escape would be wrong, so a timer that fires while the
 * document is hidden defers its verdict until the app is visible again.
 */
export function afterSave(to: string, onStuck?: (path: string) => void, startedAt?: number): void {
  // The person went somewhere themselves while the write was in flight. Their
  // navigation wins; ours would cancel it and drop them back here.
  if (startedAt !== undefined && lastLinkTapAt > startedAt) {
    noteDiagnostic('navigation', 'after-save yielded to the person’s own navigation');
    return;
  }

  const here = window.location.href;
  const path = sameOriginPath(to, here);
  if (path === null) {
    // Not swallowed: reported, then this page is reloaded, because the save
    // succeeded and the person must end up looking at saved data.
    console.error(`afterSave: refusing an off-origin destination after a save: ${to}`);
    noteDiagnostic('navigation', 'after-save destination refused');
    window.location.assign(currentPath());
    return;
  }

  noteDiagnostic('navigation', 'after-save assign');

  let settled = false;
  const report = () => {
    if (settled) return;
    if (document.hidden) {
      // Not a failure yet: decide when the app comes back to the foreground.
      document.addEventListener('visibilitychange', report, { once: true });
      return;
    }
    settled = true;
    noteDiagnostic('navigation', `after-save did not commit in ${STUCK_AFTER_MS}ms`);
    console.error(`afterSave: navigation to ${path} had not committed after ${STUCK_AFTER_MS}ms`);
    onStuck?.(path);
  };
  const timer = window.setTimeout(report, STUCK_AFTER_MS);
  // pagehide fires in WebKit where beforeunload is unreliable. It is the only
  // cancel: it means the document really is going away.
  window.addEventListener(
    'pagehide',
    () => {
      settled = true;
      window.clearTimeout(timer);
    },
    { once: true },
  );

  window.location.assign(path);
}
