import { test, expect } from '@playwright/test';
import { createWorkspaceViaWizard, loginPlatformOwner, resetLoginThrottle, strongPassword, uniq } from './helpers';

/**
 * The Content-Security-Policy, exercised by a real browser.
 *
 * tests/security/csp.spec.ts checks the header the middleware emits. That is not
 * the same as proving the application still works under it: a nonce in
 * `script-src` makes browsers ignore `'unsafe-inline'` entirely, so a single
 * un-nonced inline script means dead JavaScript on a page that still renders
 * server-side — a form that looks fine and does nothing when submitted.
 *
 * These cases assert on what the browser reports, not on what the server sent.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Content-Security-Policy in a browser', () => {
  const run = uniq();
  const workspace = {
    displayName: `CSP Workspace ${run}`,
    slug: `csp-${run}`,
    adminName: 'CSP Administrator',
    adminEmail: `admin.csp.${run}@masterapp.local`,
    adminPassword: strongPassword(`csp${run}`),
    modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
  };

  test.beforeAll(resetLoginThrottle);

  /** Console errors that are specifically CSP refusals. */
  function watchForViolations(page: import('@playwright/test').Page): string[] {
    const violations: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      if (/content security policy|refused to (execute|load|apply|connect)/i.test(text)) violations.push(text);
    });
    page.on('pageerror', (error) => {
      if (/content security policy/i.test(error.message)) violations.push(error.message);
    });
    return violations;
  }

  test('the sign-in page carries a nonce and runs its scripts', async ({ page }) => {
    const violations = watchForViolations(page);

    // Fetched before the navigation, and header and body taken from the *same*
    // response: the nonce is generated per request, so reading the two from
    // different requests could never agree.
    const served = await page.request.get('/login');
    const csp = served.headers()['content-security-policy'] ?? '';
    expect(csp, 'no CSP header on the login page').toMatch(/script-src[^;]*'nonce-/);

    /**
     * The header is asserted in tests/security/csp.spec.ts. What a browser adds
     * is whether the page still works under it: a nonce in `script-src` makes
     * `'unsafe-inline'` inert, so one un-nonced inline script means silent dead
     * JavaScript. Chromium reports each refusal to the console, which is what
     * `violations` collects.
     */

    // Then load it in a browser and confirm nothing was refused.
    await page.goto('/login');
    expect(violations, violations.join('\n')).toEqual([]);
  });

  test('hydration works: a client component responds to input', async ({ page }) => {
    const violations = watchForViolations(page);
    await page.goto('/login');

    // Typing is React state, not the DOM default — if the bundle did not run,
    // the controlled input keeps whatever it was given and this reads back empty.
    await page.getByLabel('Email').fill('hydration@example.test');
    await expect(page.getByLabel('Email')).toHaveValue('hydration@example.test');

    // And a submit reaches the network, which is what a blocked bundle prevents.
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/v1/auth/login')),
      page.getByRole('button', { name: 'Sign in' }).click(),
    ]);
    expect(response.status()).toBeGreaterThan(0);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  test('an authenticated workspace page loads its chunks and posts a form', async ({ page }) => {
    const violations = watchForViolations(page);

    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);

    // The wizard is a five-step client component that only advances if its
    // JavaScript ran, and it finished — but assert the browser stayed quiet too.
    expect(violations, violations.join('\n')).toEqual([]);
  });

  test('dynamic navigation between routes pulls chunks without refusal', async ({ page }) => {
    const violations = watchForViolations(page);

    await loginPlatformOwner(page);
    await page.goto('/platform/workspaces');
    // Client-side navigation fetches route chunks at runtime — the case
    // `strict-dynamic` exists to allow and the one most likely to break.
    await page.getByRole('link', { name: 'Plans' }).first().click();
    await expect(page).toHaveURL(/\/platform\/plans/);
    await page.getByRole('link', { name: 'Users' }).first().click();
    await expect(page).toHaveURL(/\/platform\/users/);

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
