import { test, expect } from '@playwright/test';
import {
  createWorkspaceViaWizard,
  loginPlatformOwner,
  login,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

/**
 * The product on a phone.
 *
 * Every signed-in screen must fit a 375px viewport without sideways scroll:
 * the sidebar becomes an off-canvas drawer behind a visible button, and the
 * wide HR tables collapse into labelled blocks (globals.css, H28). A page that
 * overflows horizontally on a phone is broken for the person checking in from
 * a site gate, which is exactly where this product gets used.
 */
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 375, height: 812 } });

test.describe('Mobile viewport', () => {
  const run = uniq();
  const workspace = {
    displayName: `Mobile Workspace ${run}`,
    slug: `mobile-${run}`,
    adminName: 'Mobile Administrator',
    adminEmail: `admin.mobile.${run}@masterapp.local`,
    adminPassword: strongPassword(`mo${run}`),
    modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
  };

  test.beforeEach(resetLoginThrottle);
  test.beforeAll(resetLoginThrottle);

  test.beforeAll(async ({ browser }) => {
    // The wizard is a desktop task; run it in its own desktop-sized page.
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    await page.close();
  });

  const PAGES = [
    'dashboard',
    'people',
    'people/check-in',
    'people/attendance',
    'people/work-locations',
    'people/leave',
    'sales/leads',
  ];

  test('no signed-in page scrolls sideways at 375px', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);

    for (const path of PAGES) {
      await page.goto(`/${workspace.slug}/${path}`);
      await expect(page.locator('main h1, main h2').first()).toBeVisible({ timeout: 60_000 });

      /**
       * Reports *what* overflowed, not just that something did.
       *
       * This assertion failed in CI on `people/work-locations` by exactly one
       * pixel while passing locally, and a bare "expected <= 0, received 1"
       * says nothing about where to look. The cause was the top bar's
       * breadcrumb, which could neither wrap nor shrink, so its rendered text
       * width was a floor on the width of the whole document — one pixel over
       * on the CI machine's font metrics, comfortably under on another's. The
       * offender list below is what turns the next such failure into a fix
       * instead of an investigation.
       *
       * Polled rather than sampled once, because a client component that sizes
       * itself after mount can be transiently wide for a frame. A persistent
       * overflow still fails: the poll expires and reports the last reading.
       */
      const offenders = async () =>
        page.evaluate(() => {
          const width = window.innerWidth;
          const over = Array.from(document.querySelectorAll('body *'))
            .map((element) => ({ element, box: element.getBoundingClientRect() }))
            // Anything inside a clipping ancestor is contained by definition —
            // the map's tiles sit well past the viewport and always have.
            .filter(({ element, box }) => box.width > 0 && box.right > width && !clipped(element))
            .map(({ element, box }) => `${element.tagName.toLowerCase()}.${element.className} right=${box.right}`);

          function clipped(element: Element): boolean {
            for (let node = element.parentElement; node; node = node.parentElement) {
              if (getComputedStyle(node).overflowX !== 'visible') return true;
            }
            return false;
          }

          return { over: [...new Set(over)].slice(0, 8), excess: document.documentElement.scrollWidth - width };
        });

      await expect
        .poll(async () => (await offenders()).excess, {
          message: `${path} must not overflow sideways — widest offenders: ${JSON.stringify((await offenders()).over)}`,
          timeout: 10_000,
        })
        .toBeLessThanOrEqual(0);
    }
  });

  test('the sidebar is a drawer: hidden until the button opens it', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(`/${workspace.slug}/dashboard`);

    const sidebar = page.locator('.lf-workspace-sidebar');
    const button = page.locator('.lf-mobile-nav-button');

    await expect(button).toBeVisible();
    // Off-canvas: present in the DOM, translated out of the viewport.
    await expect(sidebar).not.toBeInViewport();

    await button.click();
    await expect(sidebar).toBeInViewport();
    // Work areas, not modules: the administrator's People work starts at Employees.
    await expect(sidebar.getByRole('link', { name: 'Employees', exact: true })).toBeVisible();
  });

  test('an HR table renders as labelled blocks, not a sideways scroll', async ({ page }) => {
    await login(page, workspace.adminEmail, workspace.adminPassword);
    await page.goto(`/${workspace.slug}/people/attendance`);
    await expect(page.locator('main h1').first()).toBeVisible({ timeout: 60_000 });

    // Below 760px the table header is visually hidden and each cell carries its
    // label via ::before — measured here through the thead clip style.
    const thead = page.locator('.lf-table thead').first();
    if (await thead.count()) {
      const clipped = await thead.evaluate((el) => getComputedStyle(el).position === 'absolute');
      expect(clipped).toBe(true);
    }
  });
});

/**
 * The sign-in screens on a phone: one column, the form using the width.
 * A later desktop rule once kept two columns at every width, so a phone showed
 * the form squeezed into the left 40% and an empty right side.
 */
test.describe('Sign-in screens on a phone', () => {
  for (const width of [360, 390, 430, 768]) {
    test(`one column at ${width}px, with the form across the screen`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        isMobile: width < 761,
        hasTouch: width < 761,
      });
      const page = await context.newPage();
      try {
        for (const path of ['/login', '/forgot-password']) {
          await page.goto(path);
          const card = page.locator('.lf-auth-card');
          await expect(card).toBeVisible();
          await expect(page.locator('.lf-auth-story')).toBeHidden();
          const box = (await card.boundingBox())!;
          expect(box.width, `${path} at ${width}px: form width`).toBeGreaterThanOrEqual(Math.min(400, width - 48) - 1);
          expect(
            Math.abs(box.x + box.width / 2 - width / 2),
            `${path} at ${width}px: form centred`,
          ).toBeLessThanOrEqual(2);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
            `${path}: page width`,
          ).toBeLessThanOrEqual(width);
        }
        await page.goto('/login');
        const [label, forgot] = await Promise.all([
          page.locator('label[for="password"]').boundingBox(),
          page.getByRole('link', { name: 'Forgot password?' }).boundingBox(),
        ]);
        expect(Math.abs(label!.y - forgot!.y), 'Password label and Forgot link share a line').toBeLessThanOrEqual(6);
      } finally {
        await context.close();
      }
    });
  }

  test('a desktop keeps the brand story beside the form', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('/login');
    await expect(page.locator('.lf-auth-story')).toBeVisible();
    expect((await page.locator('.lf-auth-pane').boundingBox())!.width).toBeGreaterThan(640);
    await page.close();
  });
});
