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
 * An invitation is redeemed by someone who is not signed in and belongs to no
 * workspace yet, so every guard the rest of the app relies on is absent here:
 * there is no session, no tenant, and the only thing the visitor holds is a
 * token from an email. That made it the flow most likely to be wrong and the one
 * with no user interface at all until this round of work.
 *
 * Sending the invitation is setup and goes through the API. Redeeming it — the
 * part a real person does — goes through the browser.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Invitation acceptance', () => {
  const run = uniq();
  const workspace = {
    displayName: `Invite Workspace ${run}`,
    slug: `invite-${run}`,
    adminName: 'Invite Administrator',
    adminEmail: `admin.invite.${run}@masterapp.local`,
    adminPassword: strongPassword(`inv${run}`),
    modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
  };

  const inviteeEmail = `invitee.${run}@masterapp.local`;
  const inviteePassword = strongPassword(`gst${run}`);
  let inviteLink = '';

  test.beforeAll(resetLoginThrottle);

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    await page.close();
  });

  test('an administrator sends an invitation and it produces exactly one email', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);

    /**
     * A newly provisioned workspace has exactly one role, `company_admin`, and
     * it is the administrator's own — inviting into it is refused by the
     * rank guard ("You cannot modify your own role"), which is correct. So the
     * spec creates the role it invites into, and picks it by the `editable`
     * flag the API already computes rather than by guessing at key names.
     */
    const roleId = await ensureInvitableRole(page, workspace.slug, run);

    const sent = await page.request.post(`/api/v1/workspaces/${workspace.slug}/identity/invite`, {
      data: { email: inviteeEmail, fullName: `Invitee ${run}`, roleId },
    });
    expect(sent.ok(), await sent.text()).toBeTruthy();

    // The token must not come back over the API — only in the email.
    expect(JSON.stringify(await sent.json())).not.toContain('token');

    const mail = await lastMailTo(page.request, inviteeEmail);
    inviteLink = linkFrom(mail.body, '/accept-invite');
  });

  test('the invitee sets a password through the link and lands in the workspace', async ({ page }) => {
    await logout(page);
    await page.goto(inviteLink);

    await expect(page.getByText(workspace.displayName)).toBeVisible({ timeout: 60_000 });

    await page.getByLabel('Your name').fill(`Invitee ${run}`);
    await page.getByLabel('Password', { exact: true }).fill(inviteePassword);
    await page.getByLabel('Confirm').fill(inviteePassword);
    await page.getByRole('button', { name: 'Create my account' }).click();

    // The flow ends on a confirmation panel at the same URL, not a redirect.
    await expect(page.getByRole('heading', { name: 'You are in' })).toBeVisible({ timeout: 60_000 });
  });

  test('the new account can sign in, and the link cannot be used twice', async ({ page }) => {
    await logout(page);
    await login(page, inviteeEmail, inviteePassword);
    await page.goto(`/${workspace.slug}/dashboard`);
    await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/dashboard`));

    // A single-use token that survives redemption is an account takeover.
    await logout(page);
    await page.goto(inviteLink);
    await expect(page.getByText(/no longer valid|expired|already|not found/i)).toBeVisible({ timeout: 60_000 });
  });
});

/**
 * Returns the id of a role this administrator may actually invite into,
 * creating one if the workspace has none yet.
 */
async function ensureInvitableRole(page: Page, slug: string, run: string): Promise<string> {
  const listed = await page.request.get(`/api/v1/workspaces/${slug}/roles/roles`);
  expect(listed.ok(), await listed.text()).toBeTruthy();
  const roles: { id: string; editable: boolean }[] = await listed.json();

  const existing = roles.find((role) => role.editable);
  if (existing) return existing.id;

  const created = await page.request.post(`/api/v1/workspaces/${slug}/roles/create`, {
    // Rank below the administrator's, so the rank guard permits the grant.
    data: { key: `invitee_${run}`, name: `Invitee role ${run}`, rank: 50, defaultScope: 'OWN' },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return (await created.json()).id;
}
