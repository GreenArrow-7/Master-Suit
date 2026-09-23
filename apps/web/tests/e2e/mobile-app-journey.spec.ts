/**
 * The first mobile-app journey, as the development shell's WebView sees it.
 *
 * The Android/iOS shell (apps/mobile) is a WebView on the server origin, so the
 * journey is the web application under a phone viewport and the shell's user
 * agent. This proves the server side of the journey; it does not prove the native
 * shell (camera prompt, cookie persistence across a real app restart, the tunnel
 * warning page) — those need a device.
 *
 * Runs against a staging workspace with existing accounts, never production:
 *   MOBILE_JOURNEY_SLUG           workspace slug
 *   MOBILE_JOURNEY_USER           an account allowed to create and edit its own leads
 *   MOBILE_JOURNEY_OTHER_USER     a second such account, whose leads the first must not see
 *   MOBILE_JOURNEY_PASSWORD       their password (read from the environment, never logged)
 */
import { test, expect, devices, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { prisma } from '@/lib/db';
import { login, resetLoginThrottle } from './helpers';

const slug = process.env.MOBILE_JOURNEY_SLUG ?? '';
const user = process.env.MOBILE_JOURNEY_USER ?? '';
const other = process.env.MOBILE_JOURNEY_OTHER_USER ?? '';
const password = process.env.MOBILE_JOURNEY_PASSWORD ?? '';
const at = (path: string) => `/${slug}${path}`;
const tag = `${Date.now().toString(36)}`;

const phone = {
  ...devices['Pixel 7'],
  userAgent: `${devices['Pixel 7'].userAgent} YouhanOneApp/0.1.0-dev-poc`,
};

test.describe('Mobile app journey (web layer of the development shell)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!slug || !user || !other || !password, 'MOBILE_JOURNEY_* staging accounts are not configured');

  let tenantId = '';
  let leadId = '';
  let othersLeadId = '';
  let signedInState: Awaited<ReturnType<BrowserContext['storageState']>>;

  async function signedIn(browser: Browser, email: string) {
    const context = await browser.newContext(phone);
    const page = await context.newPage();
    await resetLoginThrottle();
    await login(page, email, password);
    return { context, page };
  }

  // The Stage row of the record's side panel, not the More or Owner menus.
  const stageButton = (page: Page) =>
    page.locator('.lf-kv > div', { has: page.locator('dt', { hasText: /^Stage$/ }) }).locator('button.lf-kv__btn');

  test('sign in, and see own leads but not a colleague’s', async ({ browser }) => {
    tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug }, select: { id: true } })).id;
    const colleague = await signedIn(browser, other);
    const theirs = await colleague.page.request.post('/api/v1/leads', {
      data: { fullName: `Colleague Lead ${tag}`, phone: `+97150${Date.now().toString().slice(-7)}` },
    });
    expect(theirs.status(), await theirs.text()).toBeLessThan(300);
    othersLeadId = (await theirs.json()).id;
    await colleague.context.close();

    const { context, page } = await signedIn(browser, user);
    const mine = await page.request.post('/api/v1/leads', {
      data: { fullName: `Mobile Journey ${tag}`, phone: `+97155${Date.now().toString().slice(-7)}` },
    });
    expect(mine.status(), await mine.text()).toBeLessThan(300);
    leadId = (await mine.json()).id;

    await page.goto(at('/sales/leads'));
    await expect(page.getByText(`Mobile Journey ${tag}`)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(`Colleague Lead ${tag}`)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);

    // A colleague's lead is refused by URL and by API, not just hidden from the list.
    await page.goto(at(`/sales/leads/${othersLeadId}`));
    await expect(page.getByText(`Colleague Lead ${tag}`)).toHaveCount(0);
    expect([403, 404]).toContain((await page.request.get(`/api/v1/leads/${othersLeadId}`)).status());

    await page.goto(at(`/sales/leads/${leadId}`));
    await expect(page.getByRole('heading', { name: `Mobile Journey ${tag}` })).toBeVisible({ timeout: 60_000 });
    signedInState = await context.storageState();
    await context.close();
  });

  test('a stage change survives closing and reopening the app, and an offline attempt saves nothing', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ...phone, storageState: signedInState });
    const page = await context.newPage();
    await page.goto(at(`/sales/leads/${leadId}`));
    await expect(stageButton(page)).toBeVisible({ timeout: 60_000 });
    const before = (await stageButton(page).textContent())!.replace('▾', '').trim();
    await stageButton(page).click();
    // The menu lists every stage; the current one carries aria-current.
    const options = await page.locator('.lf-menu__item').allTextContents();
    const next = options.map((o) => o.trim()).find((o) => o && o !== before)!;
    expect(next, 'another stage to move to').toBeTruthy();

    // Offline: an honest error, nothing written.
    const historyBefore = await prisma.leadStageHistory.count({ where: { tenantId, leadId } });
    await context.setOffline(true);
    await page.locator('.lf-menu__item', { hasText: next }).first().click();
    await expect(page.getByText(/Nothing was saved/)).toBeVisible();
    expect(await prisma.leadStageHistory.count({ where: { tenantId, leadId } })).toBe(historyBefore);

    // Back online: the same change, tapped twice, lands once.
    await context.setOffline(false);
    await stageButton(page).click();
    await page.locator('.lf-menu__item', { hasText: next }).first().dblclick();
    await expect(stageButton(page)).toContainText(next, { timeout: 30_000 });
    await expect.poll(() => prisma.leadStageHistory.count({ where: { tenantId, leadId } })).toBe(historyBefore + 1);
    signedInState = await context.storageState();
    await context.close();

    // "Relaunch": a fresh browser context carrying only the persisted cookies.
    const relaunched = await browser.newContext({ ...phone, storageState: signedInState });
    const again = await relaunched.newPage();
    await again.goto(at(`/sales/leads/${leadId}`));
    await expect(stageButton(again)).toContainText(next, { timeout: 60_000 });
    await relaunched.close();
  });

  test('a photo attaches to the lead; a refused camera and a dropped connection each explain what happened', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ...phone, storageState: signedInState });
    const page = await context.newPage();
    await page.goto(at(`/sales/leads/${leadId}`));
    await page
      .getByRole('button', { name: 'Documents' })
      .or(page.getByRole('tab', { name: 'Documents' }))
      .first()
      .click();
    const camera = page.locator('input[type="file"][capture]');
    await expect(camera).toHaveCount(1, { timeout: 60_000 });

    // Camera refused or dismissed: no file, only a cancel event — and a way forward.
    await camera.dispatchEvent('cancel');
    await expect(page.getByText(/No photo was added/)).toBeVisible();

    const photo = {
      name: `site-photo-${tag}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    };
    const documentsBefore = await prisma.document.count({ where: { tenantId, leadId } });
    await context.setOffline(true);
    await camera.setInputFiles(photo);
    await expect(page.getByText(/The file was not uploaded/)).toBeVisible();
    expect(await prisma.document.count({ where: { tenantId, leadId } })).toBe(documentsBefore);

    await context.setOffline(false);
    await camera.setInputFiles(photo);
    await expect(page.getByText(photo.name)).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await page
      .getByRole('button', { name: 'Documents' })
      .or(page.getByRole('tab', { name: 'Documents' }))
      .first()
      .click();
    await expect(page.getByText(photo.name)).toHaveCount(1);
    expect(await prisma.document.count({ where: { tenantId, leadId } })).toBe(documentsBefore + 1);
    await context.close();
  });

  test('sign out ends the session; signing out everywhere ends it on the other phone', async ({ browser }) => {
    const first = await signedIn(browser, user);
    const second = await signedIn(browser, user);
    await second.page.goto(at('/sales/leads'));
    expect((await second.page.request.get('/api/v1/leads')).status()).toBe(200);

    // Everywhere: the other phone's next request is refused and its next screen is sign-in.
    expect((await first.page.request.post('/api/v1/auth/logout-all')).status()).toBeLessThan(300);
    expect((await second.page.request.get('/api/v1/leads')).status()).toBe(401);
    await second.page.goto(at('/sales/leads'));
    await expect(second.page).toHaveURL(/\/login/, { timeout: 60_000 });

    // Plain sign-out from the account menu.
    const third = await signedIn(browser, user);
    await third.page.goto(at('/sales/leads'));
    await third.page.getByLabel('Preferences and account').click();
    await third.page.getByRole('button', { name: 'Sign out' }).click();
    await expect(third.page).toHaveURL(/\/login/, { timeout: 60_000 });
    expect((await third.page.request.get('/api/v1/leads')).status()).toBe(401);
    /**
     * Back after signing out must not put the account's records back on screen.
     *
     * This assertion needs a **production build** and fails against `next dev`,
     * which is not a defect in either. Next sets the page's `Cache-Control` from
     * `if (this.dev)` (server/base-server.js): dev sends `no-cache,
     * must-revalidate` — and its comment says that is deliberate, "so the browser
     * can restore them from the HTTP cache on back/forward instead of reloading" —
     * while a production build sends `private, no-cache, no-store, max-age=0,
     * must-revalidate`. It is the `no-store` that keeps the page out of the
     * back/forward cache, so only the production build is the thing being
     * asserted about here. Verified both ways: dev fails this line, `npm run
     * start:local` passes it, with the session equally dead in both (the 401
     * above holds either way).
     *
     * So run this file with `APP_URL` pointed at `npm run start:local`, not at a
     * dev server. Worth knowing before reading a failure here as a leak.
     */
    await third.page.goBack();
    await expect(third.page.getByText(`Mobile Journey ${tag}`)).toHaveCount(0);

    for (const session of [first, second, third]) await session.context.close();
  });
});
