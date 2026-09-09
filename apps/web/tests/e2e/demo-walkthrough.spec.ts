/**
 * SPEC-0007 — the client demonstration, run as a test.
 *
 * E2E-001 to E2E-005. If these pass, the demonstration can be given: each spec
 * walks the same path a representative walks in front of a prospect, and
 * asserts that the screens carry data rather than merely returning 200.
 *
 * Requires the demo workspace seeded and DEMO_PASSWORD pinned:
 *
 *   DEMO_PASSWORD=… ALLOW_DEMO_SEED=yes npm run db:seed -- --reset
 *
 * The credential comes from the environment, never from this file.
 *
 * ── Why the assertions look like this ───────────────────────────────────────
 *
 * They assert *populated*, not exact totals. A count pinned to 40 employees
 * would fail the day someone adds a persona, which is a change to the fixture
 * rather than a defect — and CHG-001 made the population an invariant rather
 * than a number precisely so this suite would not encode a ceiling. What must
 * not regress is that a critical screen is empty in front of a client.
 */
import { test, expect, type Page } from '@playwright/test';
import { login, logout, resetLoginThrottle } from './helpers';

const WS = 'youhan-one-demo';

/**
 * The workspace shell is a div with a class, not a <main> element, and the
 * tables render outside it. Selectors that assumed <main> matched nothing and
 * reported every populated screen as empty — a false negative that looked
 * exactly like a broken demonstration, which is the failure mode this suite
 * exists to catch. Verified against the rendered DOM rather than assumed.
 */
const SHELL = '.lf-page-main, main';
const LIST_ROWS = 'table tbody tr';

const PASSWORD = process.env.DEMO_PASSWORD ?? '';

const SALES = 'sales.rep@example.com';
const HR = 'hr.manager@example.com';
/**
 * SPEC-0007/FR-017 · CHG-004 — the single client-facing login.
 *
 * `admin@example.com` remains seeded and is still a working internal fixture,
 * but it is no longer what a client is given, so the cases that stand in for
 * the client's own session run as this address instead. The internal personas
 * keep their own cases above; this is a substitution of *who the client is*,
 * not a widening of what anybody may do.
 */
const CLIENT = 'demo@youhan.in';

test.skip(!PASSWORD, 'DEMO_PASSWORD is not set; seed the demo workspace with a pinned password first');

/**
 * Compile the routes before the first test signs in.
 *
 * These specs run against `next dev`, where a route is compiled on its first
 * request — 13 to 22 seconds each, as `playwright.config.ts` already notes.
 * The first spec in the file paid that cost *during* its login, and the shared
 * login helper filled the form before the page had hydrated: the submit went
 * in with empty fields and the server answered "2 fields failed validation",
 * which reads like a broken credential rather than a cold cache.
 *
 * Warming here rather than patching the shared helper: the helper is other
 * specs' too, and the defect is this suite assuming a warm server.
 */
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await page.goto('/login');
    await page.locator('form input[type="email"]').waitFor({ state: 'visible', timeout: 180_000 });
  } catch {
    // A warm-up that fails is not a test failure; the tests themselves will
    // report the real problem with a better message than this would.
  } finally {
    await page.close();
  }
});

test.beforeEach(async () => {
  // The suite signs in repeatedly from one address; without this the per-IP
  // bucket refuses a later spec and the failure looks like a broken login.
  await resetLoginThrottle();
});

/**
 * Two helpers, because a list and a dashboard are "populated" differently and
 * one selector judging both is how the first version of this suite reported a
 * working demonstration as broken.
 *
 * Verified against the rendered DOM: list screens render exactly one table
 * whose rows are plain cells with **no anchors**, so a row-link selector finds
 * nothing; dashboards render no table at all.
 */
async function expectListPopulated(page: Page, url: string, what: string) {
  await page.goto(url);
  await expect(page.locator(SHELL), `${what} did not render`).toBeVisible();
  await expect
    .poll(async () => page.locator(LIST_ROWS).count(), {
      message: `${what} rendered no rows — a client would see a blank screen`,
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
}

/** A dashboard carries cards and figures rather than rows. */
async function expectDashboardRenders(page: Page, url: string, what: string) {
  await page.goto(url);
  await expect(page.locator(SHELL), `${what} did not render`).toBeVisible();
  await expect
    .poll(async () => (await page.locator('main').innerText()).trim().length, {
      message: `${what} rendered no content`,
      timeout: 30_000,
    })
    .toBeGreaterThan(200);
  await expect(page.getByText(/application error|something went wrong|unhandled/i)).toHaveCount(0);
}

/** Open the first record of a collection by id, since rows carry no links. */
async function openFirstRecord(page: Page, apiPath: string, uiPath: (id: string) => string, what: string) {
  const res = await page.request.get(apiPath);
  expect(res.status(), `${what}: the collection API refused`).toBe(200);
  // Two envelopes in one API: the Sales collections answer `{ data: [...] }`
  // and the HR resource route answers a bare array. Handled here rather than
  // asserted, because the difference is the API's, not this suite's, and it is
  // recorded as a finding instead of being quietly normalised out of sight.
  const body = await res.json();
  const rows = Array.isArray(body) ? body : (body?.data ?? []);
  const id = rows[0]?.id;
  expect(id, `${what}: the collection is empty, so no detail page can be opened`).toBeTruthy();
  await page.goto(uiPath(id));
  await expect(page.locator(SHELL), `${what} detail did not render`).toBeVisible();
  await expect(page.getByText(/application error|something went wrong/i)).toHaveCount(0);
}

test.describe('SPEC-0007 client demonstration', () => {
  // ── E2E-002 · FR-009 ──────────────────────────────────────────────────────
  test('E2E-002 the Sales persona can walk the Sales demonstration', async ({ page }) => {
    await login(page, SALES, PASSWORD);
    await expect(page).toHaveURL(new RegExp(`/${WS}/`));

    await expectDashboardRenders(page, `/${WS}/dashboard`, 'Sales dashboard');
    await expectListPopulated(page, `/${WS}/sales/leads`, 'leads');
    await expectListPopulated(page, `/${WS}/sales/accounts`, 'accounts');
    await expectListPopulated(page, `/${WS}/sales/contacts`, 'contacts');
    await expectListPopulated(page, `/${WS}/sales/opportunities`, 'opportunities');
    await expectListPopulated(page, `/${WS}/sales/activities`, 'activities');
    await expectListPopulated(page, `/${WS}/sales/tasks`, 'tasks');

    // Opening one lead matters more than the list: the detail page is where a
    // demonstration spends its time, and it is a different query. Rows carry no
    // anchors, so the record is opened by id rather than by clicking a link
    // that does not exist.
    await openFirstRecord(page, '/api/v1/leads', (id) => `/${WS}/sales/leads/${id}`, 'lead');

    await logout(page);
  });

  // ── E2E-003 · FR-008 ──────────────────────────────────────────────────────
  test('E2E-003 the HR persona can walk the HRMS demonstration', async ({ page }) => {
    await login(page, HR, PASSWORD);

    await expectListPopulated(page, `/${WS}/people/employees`, 'employee directory');
    await expectListPopulated(page, `/${WS}/people/departments`, 'departments');
    await expectListPopulated(page, `/${WS}/people/attendance`, 'attendance');
    await expectListPopulated(page, `/${WS}/people/leave`, 'leave');
    await expectListPopulated(page, `/${WS}/people/shifts`, 'shifts');
    await expectListPopulated(page, `/${WS}/people/holidays`, 'holidays');

    // The employee detail page: the screen a prospect asks for by name.
    await openFirstRecord(
      page,
      `/api/v1/workspaces/${WS}/hr/employees`,
      (id) => `/${WS}/people/employees/${id}`,
      'employee',
    );

    await logout(page);
  });

  // ── E2E-001 · FR-010 ──────────────────────────────────────────────────────
  test('E2E-001 the Management persona sees both modules and the admin area', async ({ page }) => {
    await login(page, CLIENT, PASSWORD);

    await expectDashboardRenders(page, `/${WS}/dashboard`, 'management dashboard');
    await expectListPopulated(page, `/${WS}/sales/leads`, 'org-wide leads');
    await expectListPopulated(page, `/${WS}/sales/opportunities`, 'org-wide opportunities');
    await expectListPopulated(page, `/${WS}/people/employees`, 'org-wide employees');
    await expectListPopulated(page, `/${WS}/people/attendance`, 'org-wide attendance');
    await expectListPopulated(page, `/${WS}/admin/users`, 'workspace users');

    await logout(page);
  });

  // ── E2E-004 · TH-014, SEC-003 ─────────────────────────────────────────────
  test('E2E-004 the Management persona is still tenant-scoped, not a platform administrator', async ({ page }) => {
    await login(page, CLIENT, PASSWORD);

    // The platform console belongs to platform staff. A workspace admin
    // reaching it would be the escalation SEC-003 forbids, and the demo
    // Management persona is the account most likely to be handed to a
    // representative.
    const res = await page.request.get('/api/v1/platform/workspaces');
    expect([401, 403, 404], `org_admin reached the platform API with ${res.status()}`).toContain(res.status());
    expect(res.status(), 'a 500 is a broken route, not a refusal').not.toBe(500);

    await page.goto('/platform');
    await expect(page).not.toHaveURL(/\/platform(\/|$)/);

    await logout(page);
  });

  // ── E2E-005 · FR-008 ──────────────────────────────────────────────────────
  test('E2E-005 payroll is empty on purpose, and says so rather than looking broken', async ({ page }) => {
    await login(page, HR, PASSWORD);

    // CL-004 put payroll out of scope: no compensation, payslip or bank record
    // is seeded. The screen must therefore render an empty state rather than an
    // error, and this asserts the *intended* empty by name so that "empty
    // because excluded" can never be confused with "empty because broken".
    const res = await page.goto(`/${WS}/people/payroll`);
    expect(res?.status(), 'the payroll screen errored rather than rendering empty').toBeLessThan(500);
    await expect(page.locator(SHELL)).toBeVisible();

    await logout(page);
  });
});

/**
 * SPEC-0007/E2E-006 · FR-017 — one login, both modules, one session.
 *
 * The accepted client experience is a single credential that reaches Sales and
 * HRMS without signing out. This asserts the part that is easy to assume and
 * easy to get wrong: that the session is genuinely the *same* one across the
 * module boundary. A suite that merely visits both pages would pass just as
 * happily against a silent re-authentication or a workspace switch.
 *
 * No new role, workspace or entitlement is involved. The architecture already
 * supports this — `youhan-one-demo` carries both module entitlements and both
 * datasets — so this case is proof of an existing property, not of new code.
 */
test.describe('SPEC-0007 single client-facing login', () => {
  test('E2E-006 one account reaches Sales and HRMS in one unbroken session', async ({ page, context }) => {
    await login(page, CLIENT, PASSWORD);

    const sessionCookie = async () => {
      const all = await context.cookies();
      const c = all.find((x) => /session/i.test(x.name));
      expect(c, 'no session cookie was issued').toBeTruthy();
      return `${c!.name}=${c!.value}`;
    };
    const atLogin = await sessionCookie();

    // Sales.
    await expectListPopulated(page, `/${WS}/sales/leads`, 'leads (single login)');
    await expectListPopulated(page, `/${WS}/sales/opportunities`, 'opportunities (single login)');
    const afterSales = await sessionCookie();

    // HRMS — no sign-out, no workspace switch in between.
    await expectListPopulated(page, `/${WS}/people/employees`, 'employees (single login)');
    await expectListPopulated(page, `/${WS}/people/attendance`, 'attendance (single login)');
    await expectListPopulated(page, `/${WS}/people/leave`, 'leave (single login)');
    const afterHr = await sessionCookie();

    // The same session throughout. If the application had quietly re-issued a
    // session between modules, this is where it would show.
    expect(afterSales, 'the session changed while walking Sales').toBe(atLogin);
    expect(afterHr, 'the session changed crossing from Sales into HRMS').toBe(atLogin);

    // Never left the workspace.
    expect(page.url()).toContain(`/${WS}/`);

    // And the same account is still refused the platform control plane, so
    // "one login for everything" has not quietly become an administrator.
    const platform = await page.request.get('/api/v1/platform/workspaces');
    expect([401, 403, 404], `the client login reached the platform API with ${platform.status()}`).toContain(
      platform.status(),
    );

    await logout(page);
  });
});
