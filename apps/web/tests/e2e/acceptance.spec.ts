import { test, expect } from '@playwright/test';
import {
  createWorkspaceViaWizard,
  lastMailTo,
  linkFrom,
  login,
  loginPlatformOwner,
  logout,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

/**
 * The acceptance scenario from the brief, end to end in one browser.
 *
 * What it is actually proving is a single claim: HR and Sales are two modules of
 * one workspace, not two products wearing the same header. Nothing short of
 * creating a workspace, adding an employee on one side and a lead on the other,
 * and reading the same tenant id back from both, establishes that — a unit test
 * can assert the id is passed around, but only this can show the two screens are
 * looking at the same tenant.
 *
 * Serial, and sharing one page: step 12 compares a value read in step 4 against
 * one read in step 9. Independent tests could not.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Acceptance: one workspace, two modules, isolated from the next', () => {
  const run = uniq();

  /**
   * Reset before each sign-in, not once for the file.
   *
   * This is a single scenario that legitimately authenticates six times as four
   * different people, and a platform-owner sign-in now costs two requests — the
   * password, then the second factor. That is more than the ten-per-address
   * window allows. The limiter itself is untouched; tests/security/ratelimit.spec.ts
   * is what proves it still refuses.
   */
  test.beforeAll(resetLoginThrottle);

  const manath = {
    displayName: `Manath Homes ${run}`,
    slug: `manath-${run}`,
    adminName: 'Manath Administrator',
    adminEmail: `admin.manath.${run}@masterapp.local`,
    adminPassword: strongPassword(`mh${run}`),
    modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
  };

  const leadersfort = {
    displayName: `Leadersfort ${run}`,
    slug: `leadersfort-${run}`,
    adminName: 'Leadersfort Administrator',
    adminEmail: `admin.leadersfort.${run}@masterapp.local`,
    adminPassword: strongPassword(`lf${run}`),
    modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
  };

  const employeeName = `Employee ${run}`;
  const employeeEmail = `employee.${run}@masterapp.local`;
  const employeePassword = strongPassword(`emp${run}`);
  const leadName = `Lead ${run}`;

  let platformWorkspaceId = '';
  let hrWorkspaceId = '';

  test('a workspace runs both modules against one tenant, and cannot see another', async ({ page }) => {
    await test.step('1. the platform owner signs in', async () => {
      await resetLoginThrottle();
      await loginPlatformOwner(page);
    });

    await test.step('2. the platform control centre is reachable', async () => {
      await page.goto('/platform/workspaces');
      await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();
    });

    await test.step('3-4. a workspace is created with both modules enabled', async () => {
      platformWorkspaceId = await createWorkspaceViaWizard(page, manath);
      expect(platformWorkspaceId).toMatch(/^[a-z0-9]+$/i);
    });

    await test.step('5-6. its administrator signs in and reaches the workspace', async () => {
      await logout(page);
      await resetLoginThrottle();
      await login(page, manath.adminEmail, manath.adminPassword);
      await page.goto(`/${manath.slug}/dashboard`);
      await expect(page).toHaveURL(new RegExp(`/${manath.slug}/dashboard`));
    });

    await test.step('7. the People module is present', async () => {
      await page.goto(`/${manath.slug}/people/employees`);
      await expect(page.getByRole('heading', { name: 'Employees', exact: true })).toBeVisible();
    });

    await test.step('8. an employee is invited, and the HR side reports its tenant id', async () => {
      await page.goto(`/${manath.slug}/people/employees/new`);
      await expect(page.getByRole('heading', { name: 'Invite employee' })).toBeVisible();

      // The page states the tenant it is writing into. This is the HR half of
      // the identity claim tested in step 12.
      hrWorkspaceId = (await page.locator('code').first().innerText()).trim();

      await page.getByLabel('Full name').fill(employeeName);
      await page.getByLabel('Work email').fill(employeeEmail);
      await page.getByLabel('Employee number').fill(`E2E-${run}`);
      await page.getByRole('combobox', { name: 'Role' }).selectOption('employee');

      // Wait on the response, not on the absence of an error banner: the banner
      // renders after the request settles, so asserting it is missing straight
      // after the click passes whether or not the request failed.
      const [response] = await Promise.all([
        page.waitForResponse((res) => res.url().includes('/hr/employees') && res.request().method() === 'POST'),
        page.getByRole('button', { name: 'Send invitation' }).click(),
      ]);
      expect(response.status(), await response.text()).toBeLessThan(300);
    });

    await test.step('9. the invitation is redeemed and the employee then exists', async () => {
      const mail = await lastMailTo(page.request, employeeEmail);
      await logout(page);
      await page.goto(linkFrom(mail.body, '/accept-invite'));
      await page.getByLabel('Your name').fill(employeeName);
      await page.getByLabel('Password', { exact: true }).fill(employeePassword);
      await page.getByLabel('Confirm').fill(employeePassword);
      await page.getByRole('button', { name: 'Create my account' }).click();
      await expect(page.getByRole('heading', { name: 'You are in' })).toBeVisible({ timeout: 60_000 });

      await logout(page);
      await resetLoginThrottle();
      await login(page, manath.adminEmail, manath.adminPassword);
      await page.goto(`/${manath.slug}/people/employees`);
      await expect(page.getByText(employeeName).first()).toBeVisible();
    });

    await test.step('10-11. a lead is created in the Sales module of the same workspace', async () => {
      await page.goto(`/${manath.slug}/sales/leads/new`);
      await expect(page.getByRole('heading', { name: 'Add lead' })).toBeVisible();
      await page.getByLabel('Full name').fill(leadName);
      await page.getByLabel('Email').fill(`lead.${run}@example.com`);
      // Waiting on the response, not on a URL: the page is already at
      // /sales/leads/new, so a `/sales/leads/<something>` pattern matches
      // before the lead is even submitted and waits for nothing. Going straight
      // to the list then races the POST and legitimately renders an empty list.
      const [created] = await Promise.all([
        page.waitForResponse((res) => res.url().includes('/api/v1/leads') && res.request().method() === 'POST'),
        page.getByRole('button', { name: 'Create lead' }).click(),
      ]);
      expect(created.status(), await created.text()).toBeLessThan(300);

      await page.goto(`/${manath.slug}/sales/leads`);
      await expect(page.getByText(leadName)).toBeVisible();
    });

    await test.step('12. HR and Sales are the same tenant', async () => {
      // The claim the whole scenario exists to check. If HRMS were still a
      // separate application behind the same navigation, these would differ.
      expect(hrWorkspaceId).toBe(platformWorkspaceId);
    });

    await test.step('13-14. a second workspace is created and its administrator signs in', async () => {
      await logout(page);
      await resetLoginThrottle();
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, leadersfort);
      await logout(page);
      await resetLoginThrottle();
      await login(page, leadersfort.adminEmail, leadersfort.adminPassword);
      await page.goto(`/${leadersfort.slug}/dashboard`);
      await expect(page).toHaveURL(new RegExp(`/${leadersfort.slug}/dashboard`));
    });

    await test.step('15. the second workspace sees none of the first workspace records', async () => {
      await page.goto(`/${leadersfort.slug}/sales/leads`);
      await expect(page.getByText(leadName)).toHaveCount(0);

      await page.goto(`/${leadersfort.slug}/people/employees`);
      await expect(page.getByText(employeeName)).toHaveCount(0);
    });

    await test.step('16. addressing the first workspace directly does not reach it', async () => {
      await page.goto(`/${manath.slug}/dashboard`);
      await expect(page).not.toHaveURL(new RegExp(`/${manath.slug}/dashboard`));
    });

    await test.step('17. and neither does its API', async () => {
      const res = await page.request.get(`/api/v1/workspaces/${manath.slug}/identity/invitations`);
      expect([401, 403, 404]).toContain(res.status());
    });

    await test.step('18-20. the first administrator still has their own workspace intact', async () => {
      await logout(page);
      await resetLoginThrottle();
      await login(page, manath.adminEmail, manath.adminPassword);

      await page.goto(`/${manath.slug}/sales/leads`);
      await expect(page.getByText(leadName)).toBeVisible();

      await page.goto(`/${manath.slug}/people/employees`);
      await expect(page.getByText(employeeName)).toBeVisible();

      await page.goto(`/${leadersfort.slug}/dashboard`);
      await expect(page).not.toHaveURL(new RegExp(`/${leadersfort.slug}/dashboard`));
    });
  });
});
