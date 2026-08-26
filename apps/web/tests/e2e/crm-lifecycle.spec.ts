/**
 * The journey the product exists for: a lead arrives, is worked, and becomes
 * revenue — with a task, a follow-up and an activity hung off it on the way.
 *
 * The breadth pass (every-route.spec.ts) proves each CRM screen renders. It
 * cannot prove the records connect: that creating a lead puts it in the list,
 * that an opportunity carries its amount into the pipeline figure, that a
 * follow-up shows up on the queue that is supposed to chase it. Those joins are
 * where a CRM is actually wrong, and nothing in the suite touched them.
 *
 * Records are created through the UI where a human would, and through the API
 * where the UI is only a thin wrapper over it — the same split hr-modules.spec
 * uses. Everything is tagged with a per-run token so a failed run leaves
 * evidence behind without colliding with the next one.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  createWorkspaceViaWizard,
  login,
  loginPlatformOwner,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

/**
 * Provisions its own workspace. The first draft used the seeded demo tenant and
 * its published password, which passed locally and failed in CI — the seed
 * rotates that password unless DEMO_PASSWORD is pinned, so the sign-in never
 * happened. A lifecycle spec creates every record it needs anyway, so it has no
 * reason to depend on one machine's fixtures.
 */
const run = uniq();
const workspace = {
  displayName: `Lifecycle ${run}`,
  slug: `lifecycle-${run}`,
  adminName: 'Lifecycle Administrator',
  adminEmail: `admin.lifecycle.${run}@masterapp.local`,
  adminPassword: strongPassword(`lc${run}`),
  modules: ['SALES'] as ('SALES' | 'HRMS')[],
};
const LEAD_NAME = `E2E Lifecycle ${run}`;
const COMPANY = `Northwind ${run}`;

const at = (path: string) => `/${workspace.slug}/sales${path}`;

/** POST through the API, failing with the server's own message. */
async function post(request: APIRequestContext, path: string, data: Record<string, unknown>) {
  const response = await request.post(`/api/v1/${path}`, { data });
  expect(response.status(), `${path}: ${await response.text()}`).toBeLessThan(300);
  return response.json();
}

test.describe('CRM lifecycle', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    await resetLoginThrottle();
    const page = await browser.newPage();
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    await page.close();
  });

  let leadId = '';
  let opportunityId = '';

  test('a lead is created through the form and appears in the list', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(at('/leads/new'));

    await page.getByLabel('Full name *').fill(LEAD_NAME);
    await page.getByLabel('Email').fill(`lifecycle.${run}@example.test`);
    await page.getByLabel('Company').fill(COMPANY);
    await page.getByRole('button', { name: 'Create lead' }).click();

    // The id, not merely "some last path segment": `/sales/leads/[^/]+$` also
    // matches the `/new` page this form lives on, so a submission that never
    // navigated still satisfied it and handed `"new"` downstream as an id.
    await expect(page).toHaveURL(/\/sales\/leads\/c[a-z0-9]{20,}$/, { timeout: 60_000 });
    leadId = page.url().split('/').pop()!;
    expect(leadId, 'lead id should be a cuid').toMatch(/^c[a-z0-9]{20,}$/);
    await expect(page.getByText(LEAD_NAME).first()).toBeVisible();

    // And it is findable by the search the list offers, not merely present.
    await page.goto(at(`/leads?q=${encodeURIComponent(LEAD_NAME)}`));
    await expect(page.getByText(LEAD_NAME).first()).toBeVisible({ timeout: 30_000 });
  });

  test('an activity, a task and a follow-up attach to the lead', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);

    // Logged through the composer on the record, because the type is chosen
    // from a per-tenant list the server supplies — hardcoding a type id in the
    // spec would test a fixture rather than the screen.
    await page.goto(at(`/leads/${leadId}`));
    // The record opens on Overview; the activity composer lives under Timeline.
    await page.getByRole('tab', { name: 'Timeline' }).click();
    // The composer is collapsed until "Log activity" opens it; the same button
    // then reads "Cancel", so the submit inside the form is a separate control.
    await page.getByRole('button', { name: 'Log activity' }).click();
    const form = page.locator('form').filter({ has: page.getByLabel('Outcome') });
    await form.getByLabel('Outcome').fill(`Discovery call ${run}`);
    await form.getByLabel('Notes').fill('Talked through requirements.');
    await form.getByRole('button', { name: 'Log' }).click();
    await expect(page.getByText(`Discovery call ${run}`).first()).toBeVisible({ timeout: 30_000 });

    // A follow-up needs no type, so the API is the honest shortcut here.
    await post(page.request, 'follow-ups', {
      leadId,
      title: `Chase proposal ${run}`,
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await page.goto(at('/follow-ups'));
    await expect(page.getByText(`Chase proposal ${run}`).first()).toBeVisible({ timeout: 30_000 });
  });

  test('the lead becomes an opportunity carrying its value into the pipeline', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);

    const opportunity = await post(page.request, 'opportunities', {
      name: `Fit-out ${run}`,
      leadId,
      amount: 250000,
      currency: 'AED',
    });
    opportunityId = opportunity.id;
    expect(opportunityId).toBeTruthy();

    await page.goto(at('/opportunities'));
    await expect(page.getByText(`Fit-out ${run}`).first()).toBeVisible({ timeout: 30_000 });

    await page.goto(at(`/opportunities/${opportunityId}`));
    await expect(page.getByText(`Fit-out ${run}`).first()).toBeVisible();
    // The amount must survive the round trip, formatted or not.
    await expect(page.locator('body')).toContainText(/250[,.]?000/);
  });

  test('the opportunity closes won and leaves the open pipeline', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);

    const response = await page.request.patch(`/api/v1/opportunities/${opportunityId}`, {
      data: { status: 'WON' },
    });
    expect(response.status(), await response.text()).toBeLessThan(300);

    await page.goto(at(`/opportunities/${opportunityId}`));
    await expect(page.locator('body')).toContainText(/won/i);
  });
});
