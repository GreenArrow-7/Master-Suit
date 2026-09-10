import { request as playwrightRequest, type APIResponse } from '@playwright/test';

/**
 * The eleven platform console routes, and a marker that only appears if that
 * page's own body was generated.
 *
 * Derived **empirically**, not by reading the source and guessing: each is a
 * phrase present in that page's rendered body for the platform owner and absent
 * from the refusal body for everyone else. Two earlier attempts got this wrong
 * and both are worth remembering, because both looked like leaks and neither
 * was:
 *
 *  - `metadata.title` renders into the shell's `<head>` for every caller and
 *    carries only the route's own name.
 *  - A single word can be a substring of a framework identifier. `'Platform'`
 *    matched `PlatformLayout` and `PlatformSettingsPage` inside the **dev
 *    server's** `NEXT_REDIRECT` stack trace — which is what CI runs, and which
 *    a production build never emits. The local production-image probes were
 *    clean and told me nothing about it.
 *
 * So: multi-word phrases, unique to the page rather than the shared shell,
 * verified absent from the refusal body in both server modes. Their absence
 * means the page body was never generated — which is the whole of `BUG-008`.
 *
 * `{workspaceId}` is substituted by the caller with a workspace the run created,
 * so the detail route is exercised against real data rather than skipped.
 */
export const PROTECTED_PLATFORM_ROUTES: { path: string; markers: string[] }[] = [
  { path: '/platform', markers: ['Accounts needing attention', 'Commercial operations'] },
  { path: '/platform/workspaces', markers: ['Manage companies', 'Search workspaces'] },
  { path: '/platform/users', markers: ['Account status', 'Enrolment required'] },
  { path: '/platform/audit', markers: ['Service reads'] },
  { path: '/platform/system-health', markers: ['Web application'] },
  { path: '/platform/settings', markers: ['Antivirus scanning', 'Current value'] },
  { path: '/platform/plans', markers: ['Included modules', 'Create plan'] },
  { path: '/platform/subscriptions', markers: ['Period ends'] },
  { path: '/platform/ai-usage', markers: ['Rows appear as calls', 'Recorded as its own'] },
  { path: '/platform/workspaces/new', markers: ['Administrator email', 'Choose the commercial plan'] },
  { path: '/platform/workspaces/{workspaceId}', markers: ['Blank means no limit', 'Company administrators and users'] },
];

/**
 * Fetch a platform route **without following the redirect**, and prove that is
 * what happened.
 *
 * ── Why this is security-critical, and not a detail ─────────────────────────
 *
 * A refused `/platform` request answers `307` with a `Location`. The defect
 * lives in the **body of that response**. Follow the redirect and the assertion
 * runs against the login page, which is clean — so the test passes, the
 * vulnerability is untouched, and nothing anywhere says so. That is exactly why
 * `BUG-008` survived: every browser, and every test that drove one, followed
 * the redirect and saw nothing wrong.
 *
 * `maxRedirects: 0` is therefore the assertion's precondition, not an option on
 * it. It lives here, once, rather than being repeated at a dozen call sites
 * where deleting it would look harmless. The returned response is checked to be
 * a redirect, so a future change that starts following them fails loudly
 * instead of quietly testing the wrong page.
 */
export async function fetchPlatformRefusal(
  baseURL: string,
  routePath: string,
  cookie?: { name: string; value: string },
): Promise<{ response: APIResponse; body: string }> {
  const context = await playwrightRequest.newContext({ baseURL });
  try {
    const response = await context.get(routePath, {
      maxRedirects: 0,
      headers: cookie ? { cookie: `${cookie.name}=${cookie.value}` } : {},
    });

    // The response under test must be the refusal itself. If this ever stops
    // being a redirect, the assertions below are inspecting the destination and
    // prove nothing.
    if (response.status() < 300 || response.status() >= 400) {
      throw new Error(
        `${routePath}: expected the original refusal (3xx), got ${response.status()}. ` +
          'Either the route stopped refusing, or redirects are being followed — ' +
          'in which case every leak assertion in this suite is inspecting the login page.',
      );
    }
    return { response, body: await response.text() };
  } finally {
    await context.dispose();
  }
}

/**
 * A session cookie for an unprivileged, signed-in persona.
 *
 * The anonymous case is easy; the one that matters is a real workspace
 * administrator holding a valid session, because that is who reported the
 * symptom and who the layout used to bounce to `/login`. Logging in through the
 * API rather than the UI keeps this a security assertion rather than a form
 * test.
 */
export async function sessionCookieFor(
  baseURL: string,
  email: string,
  password: string,
): Promise<{ name: string; value: string }> {
  const context = await playwrightRequest.newContext({ baseURL });
  try {
    const login = await context.post('/api/v1/auth/login', { data: { email, password } });
    if (!login.ok()) throw new Error(`could not sign in as ${email}: ${login.status()}`);
    const { cookies } = await context.storageState();
    const session = cookies.find((c) => c.name === 'lf_session');
    if (!session) throw new Error(`no session cookie after signing in as ${email}`);
    return { name: session.name, value: session.value };
  } finally {
    await context.dispose();
  }
}
