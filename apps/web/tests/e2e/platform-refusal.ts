import { request as playwrightRequest, type APIResponse } from '@playwright/test';

/**
 * The eleven platform console routes, and a marker that only appears if that
 * page's own body was generated.
 *
 * Derived from each page's **body**, and deliberately not from its
 * `metadata.title`. A title is rendered into the document head of the shell for
 * everyone, contains only the route's own name, and is not protected data — an
 * assertion against it fails on a perfectly safe response and would have been
 * "fixed" by weakening the test. Markers here must be content the page itself
 * produces, so their absence means the body was never generated, which is the
 * whole of `BUG-008` / `SEC-OBS-014`.
 *
 * `{workspaceId}` is substituted by the caller with a workspace the run created,
 * so the detail route is exercised against real data rather than skipped.
 */
export const PROTECTED_PLATFORM_ROUTES: { path: string; markers: string[] }[] = [
  { path: '/platform', markers: ['Recent platform activity', 'Privileged without MFA', 'Locked accounts'] },
  { path: '/platform/workspaces', markers: ['Customers'] },
  { path: '/platform/users', markers: ['Identity &amp; recovery'] },
  { path: '/platform/audit', markers: ['Actor', 'LOGIN'] },
  { path: '/platform/system-health', markers: ['Healthy'] },
  { path: '/platform/settings', markers: ['Platform', 'Upload'] },
  { path: '/platform/plans', markers: ['No limit'] },
  { path: '/platform/subscriptions', markers: ['Commercial'] },
  { path: '/platform/ai-usage', markers: ['On the deployment key', 'Workspaces using AI'] },
  { path: '/platform/workspaces/new', markers: ['Customer provisioning'] },
  { path: '/platform/workspaces/{workspaceId}', markers: ['Subscription at a glance'] },
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
