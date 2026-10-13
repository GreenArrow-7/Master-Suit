/**
 * A lead's phone and email, masked for a role without leads:VIEW_SENSITIVE_FIELDS
 * (M2-06): the telecaller sees "+971•••••••12" and has nothing to dial, mail or
 * WhatsApp from it, yet "Call with AI assistance" still places the call to the
 * lead's real number. The administrator, who holds the permission, sees it whole.
 *
 * Provisions its own workspace, like crm-lifecycle.spec.ts, so it does not
 * depend on the demo seed's password.
 */
import { expect, test, type BrowserContext } from '@playwright/test';
import {
  createWorkspaceViaWizard,
  login,
  loginPlatformOwner,
  ok,
  post,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

const run = uniq();
const workspace = {
  displayName: `Masking ${run}`,
  slug: `masking-${run}`,
  adminName: 'Masking Administrator',
  adminEmail: `admin.masking.${run}@masterapp.local`,
  adminPassword: strongPassword(`mk${run}`),
  modules: ['SALES'] as ('SALES' | 'HRMS')[],
};
// Leads are unique by phone in a workspace.
const PHONE = `+97150${String(Date.now()).slice(-7)}`;
const MASKED = `+971${'•'.repeat(PHONE.length - 6)}${PHONE.slice(-2)}`;
const EMAIL = `buyer.${run}@example.com`;
const base = () => process.env.APP_URL ?? 'http://localhost:3000';
const at = (path: string) => `/${workspace.slug}/sales${path}`;

test.describe('a lead masked for a role without view sensitive fields', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(4 * 60_000);

  let leadId = '';
  let telecaller: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    await resetLoginThrottle();
    const page = await browser.newPage();
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    await page.close();
  });

  test.afterAll(async () => {
    await telecaller?.close();
  });

  test('the administrator builds a telecaller role without it and adds a lead', async ({ page, browser }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);
    const roles = `workspaces/${workspace.slug}/roles`;
    const role = await post(page.request, `${roles}/create`, {
      key: `telecaller_${run}`,
      name: 'Telecaller',
      rank: 60,
      defaultScope: 'ORGANIZATION',
    });
    const matrix = await ok(await page.request.get(`/api/v1/${roles}/matrix?roleId=${role.id}`), 'matrix');
    const wanted = ['leads:VIEW', 'leads:CREATE', 'leads:EDIT', 'calls:VIEW', 'calls:CREATE'];
    const rows = (matrix.permissions as { permissionId: string; module: string; action: string }[]).filter((p) =>
      wanted.includes(`${p.module}:${p.action}`),
    );
    expect(rows).toHaveLength(wanted.length);
    await post(page.request, `${roles}/matrix-update`, {
      roleId: role.id,
      changes: rows.map((p) => ({ permissionId: p.permissionId, granted: true, scope: 'ORGANIZATION' })),
    });

    const email = `telecaller.${run}@masterapp.local`;
    const account = await post(page.request, `workspaces/${workspace.slug}/identity/account-create`, {
      fullName: `Telecaller ${run}`,
      employeeNumber: `TC-${run}`,
      email,
      roleId: role.id,
      joinedOn: new Date().toISOString().slice(0, 10),
      attendanceEligible: false,
    });
    leadId = (await post(page.request, 'leads', { fullName: `Masked Lead ${run}`, phone: PHONE, email: EMAIL })).id;

    telecaller = await browser.newContext({ baseURL: base() });
    await ok(
      await telecaller.request.post('/api/v1/auth/login', { data: { email, password: account.temporaryPassword } }),
      'telecaller login',
    );
    await ok(
      await telecaller.request.post(`/api/v1/workspaces/${workspace.slug}/identity/self/password-change`, {
        data: { currentPassword: account.temporaryPassword, newPassword: strongPassword(`tc${run}`) },
      }),
      'telecaller password change',
    );
  });

  test('the telecaller sees the number masked and has nothing to dial, mail or WhatsApp', async () => {
    const page = await telecaller.newPage();
    await page.goto(at(`/leads/${leadId}`));
    await expect(page.getByText(`Masked Lead ${run}`).first()).toBeVisible();
    await expect(page.getByText(MASKED).first()).toBeVisible();
    await expect(page.getByText(PHONE)).toHaveCount(0);
    await expect(page.getByText(EMAIL)).toHaveCount(0);

    const phone = page.getByRole('button', { name: 'Phone', exact: true });
    await expect(phone).toBeDisabled();
    await expect(phone).toHaveAttribute('title', /masked/);
    await expect(page.getByRole('button', { name: 'Email', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'WhatsApp', exact: true })).toHaveCount(0);
    await expect(page.locator('a[href^="tel:"], a[href*="wa.me"], a[href^="mailto:"]')).toHaveCount(0);

    const api = await ok(await telecaller.request.get(`/api/v1/leads/${leadId}`), 'lead');
    expect(api.phone).toBe(MASKED);

    // The list: the call can be logged, but there is no number to dial (PROP-02.2).
    await page.goto(at('/leads'));
    await expect(page.getByRole('button', { name: `Log call for Masked Lead ${run}` }).first()).toBeVisible();
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
    await page.close();
  });

  test('the assisted call still goes to the real number', async ({ page }) => {
    const mine = await telecaller.newPage();
    await mine.goto(at(`/leads/${leadId}`));
    await mine.getByRole('button', { name: 'Call with AI assistance' }).click();
    await expect(mine).toHaveURL(new RegExp(`/sales/calls/new\\?leadId=${leadId}$`));
    await expect(mine.getByText(`Masked Lead ${run}`)).toBeVisible();
    await mine.getByRole('button', { name: 'Create & open live workspace' }).click();
    await expect(mine).toHaveURL(/\/sales\/calls\/[a-z0-9]+\/live$/);
    const callId = mine.url().match(/calls\/([a-z0-9]+)\/live$/)![1]!;
    const seen = await ok(await telecaller.request.get(`/api/v1/calls/${callId}`), 'call as telecaller');
    expect(seen.recipientNumber).toBe(MASKED);
    await mine.close();

    // The administrator holds the permission: the stored number is the lead's.
    await login(page, workspace.adminEmail, workspace.adminPassword);
    const stored = await ok(await page.request.get(`/api/v1/calls/${callId}`), 'call as administrator');
    expect(stored.recipientNumber).toBe(PHONE);
    await page.goto(at(`/leads/${leadId}`));
    await expect(page.getByText(PHONE).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Phone', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'WhatsApp', exact: true })).toBeVisible();
  });
});
