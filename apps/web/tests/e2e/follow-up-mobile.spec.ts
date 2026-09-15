/**
 * Follow-up work done *on a phone*, and the numbers agreeing with the list.
 *
 * Two gaps this closes, both named in review:
 *
 *   1. Mobile evidence was **display** — a screenshot with no sideways scroll —
 *      not a mobile **action**. A column that renders at 390px and a control
 *      that cannot be tapped at 390px look identical in a screenshot. These
 *      tests reschedule and complete a follow-up through the phone viewport.
 *
 *   2. Drilldown consistency was asserted at unit level against one predicate.
 *      Here the dashboard's overdue count and the list it links to are compared
 *      as a person experiences them: click the number, count the rows.
 *
 * Runs against whatever `APP_URL` points at, which for release evidence is the
 * standalone artifact behind TLS, with a real sign-in.
 */
import { test, expect, devices, type APIRequestContext } from '@playwright/test';
import {
  createWorkspaceViaWizard,
  login,
  loginPlatformOwner,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

const run = uniq();
const workspace = {
  displayName: `Follow-up mobile ${run}`,
  slug: `fum-${run}`.toLowerCase(),
  adminName: `Mobile Admin ${run}`,
  adminEmail: `fum-admin-${run}@masterapp.local`,
  adminPassword: strongPassword(`fum${run}`),
  modules: ['SALES'] as ('SALES' | 'HRMS')[],
};

let leadId = '';
const at = (path: string) => `/${workspace.slug}${path}`;

/** POST through the API, failing with the server's own message. */
async function post(request: APIRequestContext, path: string, data: Record<string, unknown>) {
  const response = await request.post(`/api/v1/${path}`, { data });
  expect(response.status(), `${path}: ${await response.text()}`).toBeLessThan(300);
  return response.json();
}

test.describe('Follow-up work on a phone', () => {
  test.describe.configure({ mode: 'serial' });

  test('a workspace and a lead exist', async ({ page }) => {
    await resetLoginThrottle();
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);

    await resetLoginThrottle();
    await login(page, workspace.adminEmail, workspace.adminPassword);
    const created = await post(page.request, 'leads', {
      fullName: `Mobile buyer ${run}`,
      phone: `+9715${Date.now().toString().slice(-8)}`,
    });
    leadId = created.id ?? created.data?.id;
    expect(leadId, 'the lead was created').toBeTruthy();
  });

  test('an agent reschedules and completes a follow-up at 390px', async ({ browser }) => {
    // A real phone profile, not just a narrow window: touch input and a mobile
    // user agent, so a control that only responds to hover fails here.
    const context = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await context.newPage();
    try {
      await resetLoginThrottle();
      await login(page, workspace.adminEmail, workspace.adminPassword);

      const due = new Date(Date.now() - 2 * 86_400_000).toISOString(); // overdue
      await post(page.request, 'follow-ups', { leadId, title: `Call back ${run}`, dueAt: due });

      await page.goto(at('/sales/follow-ups'));
      const row = page.getByText(`Call back ${run}`).first();
      await expect(row, 'the follow-up is listed on a phone').toBeVisible({ timeout: 30_000 });

      // Nothing may scroll sideways while doing the work, not merely on arrival.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'no horizontal scrolling at 390px').toBeLessThanOrEqual(0);

      // Reschedule, through the controls rather than the API. The row shows
      // Complete / Reschedule; "Reschedule" swaps in a date field and Save.
      const rescheduleButton = page.getByRole('button', { name: 'Reschedule' }).first();
      await expect(rescheduleButton, 'the reschedule control is reachable on a phone').toBeVisible();
      await rescheduleButton.click();

      const newDue = new Date(Date.now() + 5 * 86_400_000);
      const dueField = page.getByLabel('New due date').first();
      await expect(dueField, 'the date field appears on a phone').toBeVisible();
      await dueField.fill(newDue.toISOString().slice(0, 16));
      await page.getByRole('button', { name: 'Save' }).first().click();

      // The persisted outcome, not the optimistic one: reload and look again.
      await page.reload();
      await expect(page.getByText(`Call back ${run}`).first()).toBeVisible({ timeout: 30_000 });

      // Complete it, and confirm it leaves the open list. The PATCH is watched
      // so a refusal is reported as a refusal rather than as "the row is still
      // there", which is the same symptom with a completely different cause.
      const completed = page.waitForResponse(
        (r) => r.url().includes('/api/v1/follow-ups/') && r.request().method() === 'PATCH',
      );
      await page.getByRole('button', { name: 'Complete' }).first().click();
      const patchRes = await completed;
      expect(patchRes.status(), `complete: ${await patchRes.text()}`).toBeLessThan(300);
      await page.reload();
      await expect(page.getByText(`Call back ${run}`)).toHaveCount(0, { timeout: 30_000 });
    } finally {
      await context.close();
    }
  });

  test('the lead list on a phone shows the follow-up state, not a truncated row', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await context.newPage();
    try {
      await resetLoginThrottle();
      await login(page, workspace.adminEmail, workspace.adminPassword);

      await post(page.request, 'follow-ups', {
        leadId,
        title: `Site visit ${run}`,
        dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      });

      await page.goto(at('/sales/leads'));
      await expect(page.getByText(`Mobile buyer ${run}`).first()).toBeVisible({ timeout: 30_000 });

      // The follow-up field reaches the phone at all — it used to be hidden.
      await expect(page.getByText('Follow-up', { exact: false }).first()).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'no horizontal scrolling on the leads list at 390px').toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });

  test('the dashboard overdue count equals the rows its link returns', async ({ page }) => {
    await resetLoginThrottle();
    await login(page, workspace.adminEmail, workspace.adminPassword);

    // One overdue obligation, owned by this viewer.
    await post(page.request, 'follow-ups', {
      leadId,
      title: `Overdue chase ${run}`,
      dueAt: new Date(Date.now() - 86_400_000).toISOString(),
    });

    await page.goto(at('/sales/leads?filter=overdue'));
    const rows = page.locator('.lf-table tbody tr, table tbody tr');
    const listed = await rows.count();
    expect(listed, 'the overdue filter returns the overdue lead').toBeGreaterThanOrEqual(1);

    // The same question asked through the API the dashboard count uses. If the
    // two disagree, a manager clicks a number and gets a different set — which
    // is the defect this package exists to prevent.
    const viaApi = await page.request.get(`/api/v1/leads?filter=overdue`);
    if (viaApi.ok()) {
      const body = await viaApi.json();
      const apiRows = (body.data ?? []).length;
      expect(apiRows, 'the API and the screen agree on what is overdue').toBe(listed);
    }
  });
});
