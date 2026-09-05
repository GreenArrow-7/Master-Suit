import { test, expect, type Page } from '@playwright/test';
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
 * The states a screen is in when it is not showing a happy list of records:
 * refused, empty, and searched-with-no-match.
 *
 * These were the gaps that made the product feel broken rather than merely
 * restricted. A permission refusal rendered "Something went wrong on our side"
 * over a "Try again" button; an empty list rendered a table header over
 * nothing; the search box in the top bar had no handler at all.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Refusal, empty and search states', () => {
  const run = uniq();
  const workspace = {
    displayName: `States Workspace ${run}`,
    slug: `states-${run}`,
    adminName: 'States Administrator',
    adminEmail: `admin.states.${run}@masterapp.local`,
    adminPassword: strongPassword(`st${run}`),
    modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
  };

  // A member with a deliberately narrow role, to be refused with.
  const memberEmail = `member.states.${run}@masterapp.local`;
  const memberPassword = strongPassword(`mb${run}`);

  // Per test, not just per file: this suite signs in more than ten times and the
  // limiter allows ten per address per fifteen minutes. The limiter is untouched
  // — tests/security/ratelimit.spec.ts is what proves it still refuses.
  test.beforeEach(resetLoginThrottle);

  // beforeAll runs before any beforeEach, so the workspace-creating hook needs
  // its own reset or it starts on whatever a previous run left in the bucket.
  test.beforeAll(resetLoginThrottle);

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    await page.close();
  });

  test('a list with nothing in it explains itself instead of showing a bare header', async ({ page }) => {
    await loginPlatformOwner(page);

    // The platform workspace table had no empty branch at all: with no rows it
    // rendered a header over nothing.
    await page.goto(`/platform/workspaces?q=no-such-workspace-${run}`);
    await expect(page.getByText(`Nothing matches "no-such-workspace-${run}"`)).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Company' })).toHaveCount(0);
  });

  test('the top bar search reaches the list and says when nothing matched', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(`/${workspace.slug}/people/employees`);

    // The box used to have no form, no handler and no submit: typing and
    // pressing Enter did nothing at all.
    const box = page.getByRole('searchbox', { name: 'Search employees' });
    await box.fill(`no-such-person-${run}`);
    await box.press('Enter');

    await expect(page).toHaveURL(new RegExp(`q=no-such-person-${run}`));
    await expect(page.getByText(new RegExp(`Nothing matches "no-such-person-${run}"`))).toBeVisible();
  });

  test('an empty search does not navigate', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(`/${workspace.slug}/people/employees`);

    const box = page.getByRole('searchbox', { name: 'Search employees' });
    await box.fill('   ');
    await box.press('Enter');

    // `?q=` with nothing in it reads as a search that matched nothing.
    await expect(page).not.toHaveURL(/[?&]q=/);
  });

  test('a refused page says it is a permission, not a fault', async ({ page }) => {
    await onboardNarrowMember(page, workspace, memberEmail, memberPassword, run);

    await logout(page);
    await login(page, memberEmail, memberPassword);

    // Roles and permissions is administration; this member holds none of it.
    await page.goto(`/${workspace.slug}/admin/roles`);

    await expect(page.getByRole('heading', { name: 'You do not have access to this page' })).toBeVisible();
    // The failure this replaces: a 500 story and a button that cannot help.
    await expect(page.getByText('Something went wrong on our side')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    // And a way to do something about it.
    await expect(page.getByRole('link', { name: 'Request access' })).toBeVisible();
  });

  test('P2-1: the dashboard hides panels the viewer may not see', async ({ page }) => {
    await login(page, memberEmail, memberPassword);
    await page.goto(`/${workspace.slug}/dashboard`);

    // The dashboard used to render headcount, today's absences, the pending
    // leave queue *and* the plan, seat usage and renewal date to anyone who
    // could sign in. A sales representative has no business reading either.
    //
    // The anchor is the header's supporting line, not the greeting: the
    // greeting changes with the clock and the viewer's name, the line under it
    // does not.
    await expect(page.getByText(/what needs your attention today/)).toBeVisible();
    await expect(page.getByText('People summary')).toHaveCount(0);
    await expect(page.getByText('Pending approvals')).toHaveCount(0);
    await expect(page.getByText(/Subscription|Seats used|Renews/)).toHaveCount(0);
  });

  test('P2-1: an administrator does see them', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(`/${workspace.slug}/dashboard`);

    // Otherwise the previous case would pass just as well against a dashboard
    // that renders nothing at all.
    await expect(page.getByText('People summary')).toBeVisible();
  });

  test('5.3-4: the sidebar omits Administration links the viewer cannot open', async ({ page }) => {
    await login(page, memberEmail, memberPassword);
    await page.goto(`/${workspace.slug}/dashboard`);

    // Permission is resolved server-side and handed to the sidebar as a list;
    // hiding a link the viewer can still reach by typing the URL would be
    // cosmetic, which is why the refusal case above exists too.
    await expect(page.getByRole('link', { name: 'Roles & permissions' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Audit logs' })).toHaveCount(0);

    // And the workspace is still usable — this is a filter, not a blank page.
    await expect(page.getByRole('link', { name: 'Dashboard' }).first()).toBeVisible();
  });

  test('the workspace navigation survives a refusal', async ({ page }) => {
    await login(page, memberEmail, memberPassword);
    await page.goto(`/${workspace.slug}/admin/roles`);

    // Rendered inside the workspace shell, so there is somewhere to go next
    // rather than a dead end.
    await expect(page.getByRole('link', { name: 'Dashboard' }).first()).toBeVisible();
  });
});

/** Invites a member into a fresh low-rank role and redeems the invitation. */
async function onboardNarrowMember(
  page: Page,
  workspace: { slug: string; adminEmail: string; adminPassword: string },
  email: string,
  password: string,
  run: string,
) {
  await login(page, workspace.adminEmail, workspace.adminPassword);

  const created = await page.request.post(`/api/v1/workspaces/${workspace.slug}/roles/create`, {
    data: { key: `narrow_${run}`, name: `Narrow ${run}`, rank: 90, defaultScope: 'OWN' },
  });
  expect(created.ok(), await created.text()).toBeTruthy();

  const sent = await page.request.post(`/api/v1/workspaces/${workspace.slug}/identity/invite`, {
    data: { email, fullName: `Narrow Member ${run}`, roleId: (await created.json()).id },
  });
  expect(sent.ok(), await sent.text()).toBeTruthy();

  const mail = await lastMailTo(page.request, email);
  await logout(page);
  await page.goto(linkFrom(mail.body, '/accept-invite'));
  await page.getByLabel('Your name').fill(`Narrow Member ${run}`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm').fill(password);
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByRole('heading', { name: 'You are in' })).toBeVisible({ timeout: 60_000 });
}
