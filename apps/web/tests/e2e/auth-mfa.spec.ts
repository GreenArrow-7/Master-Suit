import { test, expect } from '@playwright/test';
import { totp } from '@/lib/auth/mfa';
import {
  createWorkspaceViaWizard,
  login,
  loginPlatformOwner,
  logout,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

/**
 * Sign-in, then two-factor enrolment and a second sign-in that demands a code.
 *
 * The enrolment screen exists because switching on a mandatory-2FA policy used
 * to lock out every account that had not already enrolled: there was no screen
 * that a not-yet-enrolled session could reach. This walks the whole path —
 * enrol, confirm, sign out, sign back in — because the failure it guards against
 * only appears on that second sign-in.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Sign-in and two-factor enrolment', () => {
  const run = uniq();
  const workspace = {
    displayName: `MFA Workspace ${run}`,
    slug: `mfa-${run}`,
    adminName: 'MFA Administrator',
    adminEmail: `admin.mfa.${run}@masterapp.local`,
    adminPassword: strongPassword(`mfa${run}`),
    modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
  };

  let secret = '';
  let recoveryCodes: string[] = [];

  test.beforeAll(resetLoginThrottle);

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    await page.close();
  });

  test('a wrong password is refused, and says so without naming the account', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(workspace.adminEmail);
    await page.getByLabel('Password', { exact: true }).fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // A class and not role=alert: Next's dev overlay renders its own empty
    // alert region on every page, which makes a role query match whether or not
    // the app said anything. Both spellings, because the redesigned sign-in
    // renders its refusal as `.lf-auth-alert` while in-app screens keep `.lf-alert`.
    const alert = page.locator('.lf-alert, .lf-auth-alert');
    await expect(alert).toBeVisible();
    // Account enumeration: the message must not confirm the address exists.
    await expect(alert).not.toContainText(workspace.adminEmail);
    await expect(page).toHaveURL(/\/login/);
  });

  test('an account enrols in two-factor and the secret is shown once', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto('/enroll-2fa');

    await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();

    /**
     * Enrolling from a full session re-authenticates before a secret is issued.
     * Whoever finishes enrolment holds a factor on the account and leaves with
     * the recovery codes, so a session borrowed for a minute must not be enough
     * — the same rule that already guards changing the password. The forced
     * first-run grant is exempt and is covered in tests/security/mfa-reauth.
     */
    await page.getByLabel('Password', { exact: true }).fill(workspace.adminPassword);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText('Enter this setup key:')).toBeVisible();

    // The setup key is the only copy the account holder ever receives.
    const key = await page.locator('code, kbd, .lf-key, [data-setup-key]').first().innerText();
    secret = key.replace(/\s+/g, '').toUpperCase();
    expect(secret.length).toBeGreaterThanOrEqual(16);

    // The enrolment page labels this "Code from the app"; "Authentication code"
    // is the login page's second-factor field.
    await page.getByLabel('Code from the app').fill(currentCode(secret));
    await page.getByRole('button', { name: 'Turn on two-factor authentication' }).click();

    // Enrolment is confirmed by what the page now shows, not by the absence of
    // an error banner.
    await expect(page.getByText('Two-factor authentication is on.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recovery codes' })).toBeVisible();

    // Shown exactly once, so this is the only chance to keep them.
    recoveryCodes = await page.getByRole('listitem').allInnerTexts();
    expect(recoveryCodes.length).toBeGreaterThan(0);
  });

  test('the next sign-in demands a code, refuses a wrong one and accepts a real one', async ({ page }) => {
    await logout(page);
    await page.goto('/login');
    await page.getByLabel('Email').fill(workspace.adminEmail);
    await page.getByLabel('Password', { exact: true }).fill(workspace.adminPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // The password alone must no longer be enough.
    const code = page.getByLabel('Authentication code');
    await expect(code).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // Six digits auto-submit (LoginForm.onCodeChange); a click would send
    // the same wrong code twice and spend two throttled attempts.
    await code.fill('000000');
    await expect(page.locator('.lf-alert, .lf-auth-alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await code.fill(currentCode(secret));
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 60_000 });
  });
  test('a recovery code signs in when the authenticator is gone, and only once', async ({ page }) => {
    // This case signs in twice more, and the three before it have already spent
    // the five-per-account allowance. Same reasoning as the file-level reset.
    await resetLoginThrottle();
    await logout(page);
    await page.goto('/login');
    await page.getByLabel('Email').fill(workspace.adminEmail);
    await page.getByLabel('Password', { exact: true }).fill(workspace.adminPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByLabel('Authentication code')).toBeVisible();

    // Before this existed the codes were issued, hashed and accepted by the API,
    // and no screen could send one — so losing the authenticator lost the
    // account while ten working codes sat in the user's password manager.
    await page.getByRole('button', { name: /Lost your authenticator/ }).click();

    const field = page.getByLabel('Recovery code');
    await expect(field).toBeVisible();

    const code = recoveryCodes[0];
    await field.fill(code);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 60_000 });

    // Spent on use: a captured code must not work a second time.
    await logout(page);
    await page.goto('/login');
    await page.getByLabel('Email').fill(workspace.adminEmail);
    await page.getByLabel('Password', { exact: true }).fill(workspace.adminPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: /Lost your authenticator/ }).click();
    await page.getByLabel('Recovery code').fill(code);
    await page.getByRole('button', { name: 'Verify and sign in' }).click();

    await expect(page.locator('.lf-alert, .lf-auth-alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

/** RFC 6238 with the app's own implementation, so a drift in it fails here too. */
function currentCode(secret: string): string {
  return totp(secret, Math.floor(Date.now() / 1000 / 30));
}
