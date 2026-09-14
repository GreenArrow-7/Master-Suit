import { randomBytes } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { generateSecret, totp } from '@/lib/auth/mfa';
import { encryptSecret } from '@/services/identity/secrets';
import { resetLoginThrottle, uniq } from './helpers';

/**
 * One email, two passwords, through the real sign-in form.
 *
 * The identity is synthetic and created as test setup; both passwords are random
 * per run and exist only in this process. The monitoring password is set through
 * the owner's own "Sign-in and passwords" screen, as a person would set it, and
 * each password is then used on the ordinary form with a live authenticator code.
 * There is no mode selector to click — the assertions are about where each
 * password lands and what that session can and cannot reach.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Dual-credential sign-in', () => {
  const run = uniq();
  const email = `dual.${run}@platform.test`;
  const passwordA = `Adm-${randomBytes(9).toString('base64url')}-Aa1`;
  const passwordB = `Mon-${randomBytes(9).toString('base64url')}-Bb2`;
  const secret = generateSecret();
  let tenantId = '';
  let userId = '';

  const code = () => totp(secret, Math.floor(Date.now() / 1000 / 30));

  async function signIn(page: Page, password: string) {
    await resetLoginThrottle();
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const field = page.getByLabel('Authentication code');
    await expect(field).toBeVisible({ timeout: 60_000 });
    // The password is not kept on the page once the server has issued a challenge.
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    await field.fill(code());
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 60_000 });
  }

  test.beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { slug: `dualcred-${run}`, legalName: `Dual ${run} LLC`, displayName: `Dual ${run}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });
    const user = await prisma.platformUser.create({
      data: {
        email,
        normalizedEmail: email,
        fullName: `Dual ${run}`,
        passwordHash: await hashPassword(passwordA),
        platformRole: 'OWNER',
        status: 'ACTIVE',
        passwordChangedAt: new Date(),
        mfaEnabled: true,
        mfaSecret: encryptSecret(secret),
      },
    });
    userId = user.id;
    await prisma.platformAccessGrant.create({
      data: {
        platformUserId: userId,
        tenantId,
        kind: 'READ',
        reason: 'Browser regression for dual-credential sign-in',
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
  });

  test.afterAll(async () => {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    if (userId) await prisma.platformUser.delete({ where: { id: userId } }).catch(() => {});
  });

  test('a wrong code after the administration password signs nobody in', async ({ page }) => {
    await resetLoginThrottle();
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(passwordA);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const field = page.getByLabel('Authentication code');
    await expect(field).toBeVisible({ timeout: 60_000 });
    await field.fill(code() === '000000' ? '111111' : '000000');
    await expect(page.locator('.lf-alert, .lf-auth-alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    expect((await page.context().cookies()).some((cookie) => cookie.name === 'lf_session')).toBe(false);
  });

  test('password A opens the console, where the monitoring password is set', async ({ page }) => {
    await signIn(page, passwordA);
    await expect(page).toHaveURL(/\/platform/);

    await page.goto('/platform/security');
    await expect(page.getByTestId('monitoring-credential-state')).toHaveText('Not set.');
    await page.getByRole('button', { name: 'Set monitoring password' }).click();
    await page.getByLabel('Current administration password').fill(passwordA);
    await page.getByLabel('Authentication code').fill(code());
    await page.getByLabel('New monitoring password').fill(passwordB);
    await page.getByLabel('Repeat the new password').fill(passwordB);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status')).toContainText('Monitoring password set');
    await expect(page.getByTestId('monitoring-credential-state')).toContainText('Set');
  });

  test('the administration password cannot be reused as the monitoring password', async ({ page }) => {
    await signIn(page, passwordA);
    await page.goto('/platform/security');
    await page.getByRole('button', { name: 'Change monitoring password' }).click();
    await page.getByLabel('Current administration password').fill(passwordA);
    await page.getByLabel('Authentication code').fill(code());
    await page.getByLabel('New monitoring password').fill(passwordA);
    await page.getByLabel('Repeat the new password').fill(passwordA);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.lf-auth-alert')).toBeVisible();
  });

  test('password B lands on read-only monitoring and reaches nothing administrative', async ({ page }) => {
    await signIn(page, passwordB);
    await expect(page).toHaveURL(/\/monitoring$/);
    await expect(page.getByTestId('monitoring-session-mode')).toContainText('read-only monitoring session');
    await expect(page.getByRole('cell', { name: `Dual ${run}`, exact: true })).toBeVisible();

    // Direct console URLs.
    for (const url of ['/platform', '/platform/security', '/platform/users']) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/no-platform-access/);
    }

    // Direct API calls from the signed-in page, same origin, same cookie.
    const statuses = await page.evaluate(async (workspaceId) => {
      const send = (url: string, method: string, body?: unknown) =>
        fetch(url, {
          method,
          headers: body ? { 'content-type': 'application/json' } : {},
          body: body ? JSON.stringify(body) : undefined,
        }).then((res) => res.status);
      return {
        createWorkspace: await send('/api/v1/platform/workspaces', 'POST', {
          slug: 'never-created',
          displayName: 'Never',
          legalName: 'Never LLC',
        }),
        breakGlass: await send(`/api/v1/platform/workspaces/${workspaceId}/access`, 'POST', {
          reason: 'Elevation attempt from a monitoring session',
        }),
        credentials: await send('/api/v1/platform/credentials', 'GET'),
      };
    }, tenantId);
    expect(statuses).toEqual({ createWorkspace: 403, breakGlass: 403, credentials: 403 });

    // Into the authorised workspace: reading works, writing does not.
    await page.goto('/monitoring');
    await page.getByRole('button', { name: /Open/ }).first().click();
    await expect(page).not.toHaveURL(/\/monitoring$/, { timeout: 60_000 });
    const inside = await page.evaluate(async () => ({
      read: (await fetch('/api/v1/leads')).status,
      write: (
        await fetch('/api/v1/leads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fullName: 'Never', phone: '+971500000009' }),
        })
      ).status,
    }));
    expect(inside).toEqual({ read: 200, write: 403 });
  });

  test('two sessions in two contexts keep their own modes', async ({ browser }) => {
    const admin = await browser.newContext();
    const monitor = await browser.newContext();
    try {
      const adminPage = await admin.newPage();
      const monitorPage = await monitor.newPage();
      await signIn(monitorPage, passwordB);
      await signIn(adminPage, passwordA);

      await adminPage.goto('/platform');
      await expect(adminPage).toHaveURL(/\/platform$/);
      await monitorPage.goto('/platform');
      await expect(monitorPage).toHaveURL(/\/no-platform-access/);

      // A second tab of the monitoring session is still monitoring.
      const secondTab = await monitor.newPage();
      await secondTab.goto('/monitoring');
      await expect(secondTab.getByTestId('monitoring-session-mode')).toContainText('read-only monitoring session');
    } finally {
      await admin.close();
      await monitor.close();
    }
  });
});
