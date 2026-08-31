import { unregisterNativePush } from '@/lib/pwa/nativePush';

/**
 * Ending a session, from the browser.
 *
 * Three buttons signed out — the top bar, the sidebar and the sales sign-off
 * card — and each posted to the logout route directly. That was fine until
 * sign-out gained a second half: a phone has to hand its push registration back,
 * or it announces the previous account's approvals on its lock screen to whoever
 * picks it up next. Three copies of a two-step sequence is two copies waiting to
 * be forgotten, so it lives here instead.
 *
 * Where to go afterwards stays with the caller — one of the three uses the
 * router and two want a full document load.
 */
export async function signOut(): Promise<void> {
  // First, and awaited: the request needs the session cookie that the next call
  // is about to revoke. A browser skips it in a microtask.
  await unregisterNativePush();
  await fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => {
    // A failed logout still clears the client. The session cookie is httpOnly
    // and cannot be removed here, but sending the person to /login is closer to
    // signed out than leaving them on a workspace screen.
  });
}
