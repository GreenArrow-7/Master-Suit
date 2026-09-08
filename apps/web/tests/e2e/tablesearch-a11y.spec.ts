import { test, expect } from '@playwright/test';
import {
  createWorkspaceViaWizard,
  login,
  loginPlatformOwner,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

/**
 * `TableSearch` — keyboard reachability and screen-reader semantics.
 *
 * SPEC-0003. The component filters the rows already on screen; two things a
 * screen-reader user needs were missing, and both were visible in the source:
 *
 *  - the "nothing matched" message sat outside any live region, so a user heard
 *    "0 of 42 shown" and was never told what to do about it;
 *  - the live region was rendered only once a query existed, and a region
 *    inserted at the same moment as its text is announced unreliably.
 *
 * What these tests are evidence of: the **browser accessibility tree** — the
 * role and accessible name a control exposes, and the content of the live
 * region. No real screen reader is exercised here and none is claimed. Whether
 * NVDA, JAWS or VoiceOver speaks a given region in a given configuration is not
 * tested by this file.
 *
 * `Escape` is deliberately untested: SPEC-0003 CL-001 put new `Escape`
 * behaviour out of scope, and the component has no key handler, so a test that
 * pressed `Escape` would assert the absence of code rather than a behaviour.
 * There is likewise no clear-button test — CL-002, and no such control exists.
 */
test.describe.configure({ mode: 'serial' });

/**
 * The status region added by SPEC-0003. Scoped by its class as well as its
 * attribute so an unrelated `aria-live` elsewhere on the page — a toast, say —
 * cannot satisfy these assertions by accident.
 */
const STATUS = '.lf-visually-hidden[aria-live="polite"]';

/** Matches nothing in any seeded directory, so the empty branch is deterministic. */
const NO_MATCH_QUERY = 'zzzz-no-such-person-zzzz';

/**
 * `WorkspaceTable`'s own threshold: below this it renders no search box at all.
 * Named rather than written as a bare 8, so `E2E-006` says *why* it creates
 * the number of rows it does. Kept in step with `SEARCHABLE_FROM` in
 * `src/components/workspace/WorkspaceTable.tsx`.
 */
const SEARCHABLE_FROM = 8;

test.describe('TableSearch accessibility', () => {
  const run = uniq();
  const workspace = {
    displayName: `A11y Workspace ${run}`,
    slug: `a11y-${run}`,
    adminName: 'A11y Administrator',
    adminEmail: `admin.a11y.${run}@masterapp.local`,
    adminPassword: strongPassword(`a1${run}`),
    modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
  };

  // The limiter allows ten sign-ins per address per fifteen minutes and this
  // file signs in on every test. Same reasoning as ui-states.spec.ts.
  test.beforeEach(resetLoginThrottle);
  test.beforeAll(resetLoginThrottle);

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    await page.close();
  });

  /**
   * The employee directory is the stable target: it renders `TableSearch`
   * unconditionally once there is at least one employee, and the workspace
   * administrator is given an employee profile at provisioning — so the table
   * has a row without this file having to hire anyone.
   */
  const directory = () => `/${workspace.slug}/sales/people`;
  const searchBox = 'Search the directory';

  // E2E-001 — FR-002, ACC-005, AC-001, AC-006
  test('the search box takes focus and does not trap it', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(directory());

    const box = page.getByRole('searchbox', { name: searchBox });
    await box.focus();
    await expect(box).toBeFocused();

    // Out of the box, and back into it. A component that swallowed keys would
    // fail one of these two.
    await page.keyboard.press('Tab');
    await expect(box).not.toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(box).toBeFocused();
  });

  // E2E-002 — ACC-001, ACC-002, AC-002
  test('the input exposes the searchbox role and is named by its visible label', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(directory());

    // Both halves are native: `type="search"` gives the role, and a real
    // `<label htmlFor>` gives the name. Asserting the outcome rather than the
    // presence of an ARIA attribute is deliberate — SPEC-0003 adds neither
    // `role` nor `aria-label`, and a test that demanded them would push the
    // component the wrong way.
    await expect(page.getByRole('searchbox', { name: searchBox, exact: true })).toBeVisible();
  });

  // E2E-003 — FR-001, FR-005, AC-003
  test('typing filters the rows and reports the count', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(directory());

    const rows = page.locator('.lf-table tbody tr');
    const total = await rows.count();
    expect(total, 'the directory should have at least one row to filter').toBeGreaterThan(0);

    await page.getByRole('searchbox', { name: searchBox }).fill(NO_MATCH_QUERY);

    await expect(page.locator('.lf-table tbody tr:visible')).toHaveCount(0);
    await expect(page.locator(STATUS)).toContainText(`0 of ${total} shown`);
  });

  // E2E-005 — ACC-003, ACC-004, AC-005
  test('the status region exists before it has anything to say, and carries the no-match message', async ({
    page,
  }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(directory());

    const status = page.locator(STATUS);

    // The defect this pilot exists to fix: before, the region was rendered only
    // once a query existed, so it was inserted at the same moment as its text.
    await expect(status).toHaveCount(1);
    await expect(status).toHaveText('');

    await page.getByRole('searchbox', { name: searchBox }).fill(NO_MATCH_QUERY);

    // And the other half: the message used to sit outside any live region.
    await expect(status).toContainText('Nothing on this page matches');
  });

  // REG-001 — FR-001
  test('clearing the query restores every row', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(directory());

    const box = page.getByRole('searchbox', { name: searchBox });
    const total = await page.locator('.lf-table tbody tr').count();

    await box.fill(NO_MATCH_QUERY);
    await expect(page.locator('.lf-table tbody tr:visible')).toHaveCount(0);

    await box.fill('');
    await expect(page.locator('.lf-table tbody tr:visible')).toHaveCount(total);
    await expect(page.locator(STATUS)).toHaveText('');
  });

  // REG-002 — NFR-003
  test('the label, input and table still render', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(directory());

    await expect(page.getByRole('searchbox', { name: searchBox })).toBeVisible();
    await expect(page.locator('.lf-table')).toBeVisible();
    // The visible count is presentational and `aria-hidden`; it must still be
    // absent until a query exists, exactly as before this change.
    await expect(page.getByText(/\d+ of \d+ shown/)).toHaveCount(0);
  });

  // E2E-006 — ACC-002, AC-007
  test('a consumer that passes no label falls back to the accessible name "Search"', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);

    // `WorkspaceTable` is the only consumer that passes no `label`, so it is
    // the only place the default can be observed. It renders `TableSearch`
    // only once its table has SEARCHABLE_FROM rows, so this test creates
    // exactly that many rather than borrowing a count it did not establish
    // (SPEC-0003/CONV-006, remediated under CHG-001).
    const api = `/api/v1/workspaces/${workspace.slug}/hr/departments`;
    for (let i = 0; i < SEARCHABLE_FROM; i += 1) {
      const created = await page.request.post(api, {
        data: { name: `A11y Department ${i} ${run}`, code: `A11Y${i}${run}`.slice(0, 20) },
      });
      expect(created.status(), await created.text()).toBeLessThan(300);
    }

    await page.goto(`/${workspace.slug}/people/departments`);
    await expect(page.locator('.lf-table tbody tr')).toHaveCount(SEARCHABLE_FROM);
    await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toBeVisible();
  });
});
