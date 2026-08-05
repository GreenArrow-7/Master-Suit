/**
 * The browser's authenticated fetch.
 *
 * The session lives in an httpOnly, SameSite=Lax cookie. **No token is ever
 * held in JavaScript**, which is the whole point: `localStorage` is readable by
 * any script that gets onto the page, so a single XSS would otherwise hand over
 * a long-lived credential. Nothing here reads or writes a token — the browser
 * attaches the cookie and the server rotates it.
 *
 * Three properties this has to get right:
 *
 * 1. **Single flight.** Ten components rendering at once will all 401 at once.
 *    Ten parallel refreshes would rotate ten times, and nine of those rotations
 *    would present an already-rotated token — which the server correctly treats
 *    as theft and responds to by revoking every session. So concurrent callers
 *    share one in-flight refresh.
 * 2. **At most one retry.** If the request 401s again after a successful
 *    refresh, the problem is not staleness. Retrying further is how a refresh
 *    loop becomes an outage.
 * 3. **Fail closed.** When refresh fails the local auth state is cleared and the
 *    caller is sent to sign in, rather than left in a half-authenticated UI that
 *    silently drops writes.
 */

/** The in-flight refresh, shared by every caller that needs one. */
let inFlight: Promise<boolean> | null = null;

/** Notified when the session ends, so the shell can react without polling. */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onSessionEnded(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function endSession() {
  for (const listener of listeners) {
    try { listener(); } catch { /* one bad listener must not stop the rest */ }
  }
}

/**
 * Rotates the session. Concurrent callers get the same promise, so N parallel
 * 401s produce exactly one POST to /auth/refresh.
 */
export function refreshSession(): Promise<boolean> {
  inFlight ??= (async () => {
    try {
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Cleared in a microtask so callers that awaited this promise all observe
      // the same result before a new refresh can start.
      queueMicrotask(() => { inFlight = null; });
    }
  })();
  return inFlight;
}

export interface AuthFetchOptions extends RequestInit {
  /** Set false to opt out of the refresh-and-retry behaviour for one call. */
  retryOnUnauthorized?: boolean;
}

/**
 * `fetch` that survives an expired session.
 *
 * On a 401 it refreshes once and replays the original request once. A second
 * 401, or a failed refresh, clears auth state and returns the response to the
 * caller rather than throwing — callers still need the status to render.
 */
export async function authFetch(input: RequestInfo | URL, options: AuthFetchOptions = {}): Promise<Response> {
  const { retryOnUnauthorized = true, ...init } = options;
  const request: RequestInit = { credentials: 'same-origin', ...init };

  let response = await fetch(input, request);
  if (response.status !== 401 || !retryOnUnauthorized) return response;

  const refreshed = await refreshSession();
  if (!refreshed) {
    endSession();
    return response;
  }

  // Exactly one retry. Whatever happens now is the answer.
  response = await fetch(input, request);
  if (response.status === 401) endSession();
  return response;
}

/**
 * Ends the session everywhere and clears local state.
 *
 * `logout-all` revokes the caller's own session too, so there is nothing left to
 * clean up server-side; the redirect is what clears the client.
 */
export async function signOut(allDevices = false): Promise<void> {
  try {
    await fetch(allDevices ? '/api/v1/auth/logout-all' : '/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } finally {
    endSession();
    // A full navigation rather than a client route change: it discards every
    // cached server component payload, which may hold data the signed-out user
    // should no longer see.
    if (typeof window !== 'undefined') window.location.href = '/login';
  }
}

/** Test seam: resets the shared refresh so specs do not leak state between cases. */
export function __resetAuthClientForTests() {
  inFlight = null;
  listeners.clear();
}
