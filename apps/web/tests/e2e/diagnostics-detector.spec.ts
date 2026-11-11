import { test, expect, type Page } from '@playwright/test';
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
 * The blank-screen detector, driven in a real browser.
 *
 * It exists to catch a fault that has never reproduced on a desk, so the thing
 * that matters is not that it fires — anything fires — but that it fires on the
 * shapes a broken screen actually takes and stays quiet on the shapes a working
 * one takes. Three of those shapes were missed by the first version and are the
 * reason this file exists:
 *
 *   - a region holding wrapper elements and no content, which a "no elements at
 *     all" rule scored as healthy;
 *   - a skeleton that never resolves, which has both text and elements and so
 *     looked like a loaded page;
 *   - content that disappears *after* the early checks, which a single look a
 *     few seconds in could not see by construction.
 *
 * This is browser evidence, not device evidence. It runs the engine Safari
 * uses, on a desk. The iPhone still has to repeat the reported journey before
 * the defect itself can be called fixed.
 *
 * The page region is manipulated directly rather than waiting for a real
 * screen to break: the fault does not reproduce on demand, which is the whole
 * problem. What is under test is the rule, and the rule reads the DOM.
 */
/**
 * Its own workspace and its own administrator, created inside the product and
 * removed by the run teardown.
 *
 * Nothing here depends on an ambient demo account: a spec that skips when some
 * variable is unset is a spec that quietly proves nothing, and this one exists
 * to hold a detector that has already been wrong twice.
 */
const run = uniq();
const workspace = {
  displayName: `Diagnostics ${run}`,
  slug: `diagnostics-${run}`,
  adminName: 'Diagnostics Administrator',
  adminEmail: `admin.diagnostics.${run}@masterapp.local`,
  adminPassword: strongPassword(`dg${run}`),
  modules: ['SALES'] as ('SALES' | 'HRMS')[],
};
const slug = workspace.slug;

/** Matches the component. A sample every 2s, confirmed twice. */
const EMPTY_AFTER_MS = 4_000;
const BUSY_AFTER_MS = 12_000;

const entries = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith('lf.diagnostics.v1:'));
    return key
      ? (JSON.parse(window.localStorage.getItem(key) ?? '[]') as { kind: string; path: string; detail: string }[])
      : [];
  });

const forget = (page: Page) =>
  page.evaluate(() => {
    for (const k of Object.keys(window.localStorage)) {
      if (k.startsWith('lf.diagnostics.v1')) window.localStorage.removeItem(k);
    }
  });

/**
 * Puts the page region into a state and *keeps* it there.
 *
 * Setting `innerHTML` once is not enough: the application re-renders over it
 * within a second or so, and the detector deliberately needs two consecutive
 * bad samples before it reports anything. A screen that is actually broken
 * stays broken, so the test has to reproduce that and not a single flicker.
 */
const holdRegion = (page: Page, html: string) =>
  page.evaluate((markup) => {
    const root = document.querySelector('[data-content-root]');
    if (!root) throw new Error('the layout no longer marks the page region with [data-content-root]');
    const w = window as unknown as { __holdRegion?: number };
    if (w.__holdRegion) window.clearInterval(w.__holdRegion);
    const apply = () => {
      const current = document.querySelector('[data-content-root]');
      if (current && current.innerHTML !== markup) current.innerHTML = markup;
    };
    apply();
    w.__holdRegion = window.setInterval(apply, 100);
  }, html);

const releaseRegion = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __holdRegion?: number };
    if (w.__holdRegion) window.clearInterval(w.__holdRegion);
    w.__holdRegion = undefined;
  });

/** The region has actually arrived: not a skeleton, and carrying content. */
const settled = async (page: Page) => {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const root = document.querySelector('[data-content-root]');
          if (!root) return 'missing';
          if (root.querySelector('[aria-busy="true"]')) return 'busy';
          return (root as HTMLElement).innerText.trim().length > 0 ? 'ready' : 'empty';
        }),
      { timeout: 60_000 },
    )
    .toBe('ready');
};

test.describe.configure({ mode: 'serial' });

test.describe('blank-screen detector', () => {
  test.beforeAll(resetLoginThrottle);

  test('a workspace and an administrator are prepared for the cases below', async ({ page }) => {
    test.setTimeout(120_000);
    await loginPlatformOwner(page);
    const id = await createWorkspaceViaWizard(page, workspace);
    expect(id).toMatch(/^[a-z0-9]+$/i);
    await logout(page);
  });

  test('records a region holding only wrapper elements', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(`/${slug}/sales/leads`);
    await forget(page);
    await page.reload();
    await settled(page);

    // Three nested wrappers and not one character: the shape a "no elements at
    // all" rule called healthy.
    await holdRegion(page, '<div><div><section><span></span></section></div></div>');

    await expect
      .poll(() => entries(page), { timeout: EMPTY_AFTER_MS + 20_000 })
      .toContainEqual(expect.objectContaining({ kind: 'blank-screen' }));
    const [entry] = (await entries(page)).filter((e) => e.kind === 'blank-screen');
    // The count is in the report because "empty but not literally empty" is
    // what the next person needs to know.
    expect(entry!.detail).toMatch(/wrapper elements/);
  });

  test('records a skeleton that never resolves', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(`/${slug}/sales/leads`);
    await forget(page);
    await page.reload();
    await settled(page);

    // A skeleton carries text and elements, which is why it reads as a loaded
    // page to anything counting either one.
    await holdRegion(page, '<div aria-busy="true"><span>Loading</span><div></div></div>');

    await expect
      .poll(() => entries(page), { timeout: BUSY_AFTER_MS + 20_000 })
      .toContainEqual(expect.objectContaining({ kind: 'stuck-skeleton' }));
  });

  test('records content that disappears after the early checks', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(`/${slug}/sales/leads`);
    await forget(page);
    await page.reload();
    await settled(page);

    await holdRegion(page, '<p>A healthy page, which is what the early samples see.</p>');
    // Well past the point a single early look would have stopped watching.
    await page.waitForTimeout(EMPTY_AFTER_MS + 8_000);
    expect(await entries(page)).toEqual([]);

    await releaseRegion(page);
    await holdRegion(page, '');
    await expect
      .poll(() => entries(page), { timeout: 20_000 })
      .toContainEqual(expect.objectContaining({ kind: 'blank-screen' }));
  });

  test('stays quiet on a page that is merely sparse', async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(`/${slug}/sales/leads`);
    await forget(page);
    await page.reload();
    await settled(page);

    // A real empty state: little text, few elements, and not a fault.
    await holdRegion(page, '<p>No leads yet.</p>');
    await page.waitForTimeout(BUSY_AFTER_MS + 4_000);

    expect(await entries(page)).toEqual([]);
  });

  test('records a failed request without its query string or body', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(`/${slug}/sales/leads`);
    await forget(page);

    // The instrument has to be in place before the request, or this test would
    // pass or fail for reasons that have nothing to do with redaction.
    await expect
      .poll(() => page.evaluate(() => (window.fetch as { __lfDiagnostics?: true }).__lfDiagnostics === true), {
        timeout: 15_000,
      })
      .toBe(true);

    const status = await page.evaluate(async () => {
      const response = await fetch(
        '/api/v1/leads/cmwbq1qcz00n07shzjd67tdor/no-such-route?q=John+Smith&token=secret123',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fullName: 'Amina Al Rashid', phone: '+971501234567' }),
        },
      );
      return response.status;
    });
    expect(status).toBe(404);

    await expect
      .poll(() => entries(page), { timeout: 10_000 })
      .toContainEqual(expect.objectContaining({ kind: 'request-failed' }));

    const stored = JSON.stringify(await entries(page));
    // The whole point of recording the save: the status, and nothing that
    // belongs to the customer.
    expect(stored).toContain('returned 404');
    expect(stored).toContain('/api/v1/leads/:id/no-such-route');
    expect(stored).not.toContain('cmwbq1qcz00n07shzjd67tdor');
    expect(stored).not.toContain('John');
    expect(stored).not.toContain('secret123');
    expect(stored).not.toContain('Amina');
    expect(stored).not.toContain('971501234567');
  });
});
