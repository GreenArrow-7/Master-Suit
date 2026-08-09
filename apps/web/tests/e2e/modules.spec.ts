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
 * One happy path per module, as §7 asks for.
 *
 * These exist because everything else in this repo verifies a module from the
 * inside: unit tests call services directly, and driving the API by hand proves
 * the API. Neither notices a page that renders 401, a link that omits the
 * workspace slug, or a permission that was never granted — and all three have
 * happened here.
 *
 * The very first run of this file failed at step 2 because a newly created
 * workspace could not reach `/sales/projects` at all: workspace provisioning
 * granted its administrator a hardcoded list of modules, and 36 of the 61 in the
 * catalogue had never been added to it. That is what this kind of test is for.
 *
 * Serial and sharing one workspace: creating one costs a five-step wizard, and
 * every step below is a different module of the same tenant.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Each module opens and does its job', () => {
  const run = uniq();

  const workspace = {
    displayName: `Modules ${run}`,
    slug: `modules-${run}`,
    adminName: 'Modules Administrator',
    adminEmail: `admin.modules.${run}@masterapp.local`,
    adminPassword: strongPassword(`mod${run}`),
    modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
  };

  const at = (path: string) => `/${workspace.slug}/sales${path}`;

  /** The page loaded, and it is the page asked for rather than a redirect. */
  async function opens(page: Page, path: string, heading: string) {
    const response = await page.goto(at(path));
    expect(response?.status(), `${path} responded ${response?.status()}`).toBeLessThan(400);
    await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/sales`));
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
  }

  test.beforeAll(resetLoginThrottle);

  test('a fresh workspace can reach and use every sales module', async ({ page }) => {
    await test.step('a workspace is created and its administrator signs in', async () => {
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, workspace);
      await logout(page);
      await resetLoginThrottle();
      await login(page, workspace.adminEmail, workspace.adminPassword);
      await page.goto(`/${workspace.slug}/dashboard`);
      await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/dashboard`));
    });

    await test.step('M4 — the project catalogue opens', async () => {
      await opens(page, '/projects', 'Projects');
    });

    await test.step('M5 — listings open', async () => {
      await opens(page, '/listings', 'Listings');
    });

    await test.step('M3 — client profiling opens, and records a profile', async () => {
      await opens(page, '/clients', 'Clients');

      // The lead the profile hangs off. Created through the API on the page's
      // own session, because the point of the step is the profile, not the
      // lead form that M2's specs already drive.
      const lead = await page.request.post('/api/v1/leads', {
        data: { fullName: `Profile subject ${run}`, phone: `+9715${Date.now().toString().slice(-8)}` },
      });
      expect(lead.status(), await lead.text()).toBeLessThan(300);
      const leadId = (await lead.json()).id;

      const saved = await page.request.post('/api/v1/client-profiles', {
        data: { leadId, profession: 'Cardiologist', purchaseIntent: 'INVESTMENT', investmentCapacity: 2_500_000 },
      });
      expect(saved.status(), await saved.text()).toBeLessThan(300);

      await page.reload();
      await expect(page.getByText('Cardiologist')).toBeVisible();
    });

    await test.step('M6 — site visits open', async () => {
      await opens(page, '/site-visits', 'Site visits');
    });

    await test.step('M7 — the dialer and allocation open', async () => {
      await opens(page, '/calls', 'Calls');
      await opens(page, '/allocation', 'Allocation');

      // Asking for leads is the flow an agent actually performs.
      const asked = await page.request.post('/api/v1/allocation', {
        data: { action: 'ASK', requested: 5, reason: `Happy path ${run}` },
      });
      expect(asked.status(), await asked.text()).toBeLessThan(300);

      await page.reload();
      await expect(page.getByText(`Happy path ${run}`)).toBeVisible();
    });

    await test.step('M9 — commissions open, and a slab cannot pay until it is signed', async () => {
      await opens(page, '/commissions', 'Commissions');
      await opens(page, '/commissions/slabs', 'Commission slabs');

      // The module ships with no rates at all, so the page states that rather
      // than showing a table of zeroes.
      await expect(page.getByText('No commission rules yet')).toBeVisible();

      const drafted = await page.request.post('/api/v1/commission-slabs', {
        data: {
          name: `Standard ${run}`,
          mode: 'FLAT',
          basis: 'PERCENT_OF_SALE',
          effectiveFrom: new Date().toISOString(),
          bands: [{ fromAmount: 0, ratePct: 2 }],
        },
      });
      expect(drafted.status(), await drafted.text()).toBeLessThan(300);

      await page.reload();
      // The badge, not the header count — the same words appear in both, and a
      // loose match is ambiguous.
      await expect(page.getByText('awaiting finance', { exact: true })).toBeVisible();
      // Drafted, and visibly not yet usable: accrual ignores an unsigned slab.
      await expect(page.getByText('not used for any calculation')).toBeVisible();
    });

    await test.step('M10 — the leader dashboard opens with a funnel', async () => {
      await opens(page, '/leadership', 'Leadership');
      await expect(page.getByText('Funnel')).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Arrived this period' })).toBeVisible();
    });

    await test.step('M10 — every report on the menu answers', async () => {
      await opens(page, '/reports', 'Reports');

      for (const [key, heading] of [
        ['lead-conversion', 'Lead conversion rate'],
        ['source-analysis', 'Source analysis'],
        ['team-performance', 'Team performance'],
      ] as const) {
        await page.goto(at(`/reports?report=${key}`));
        // These links used to omit the workspace slug and 404.
        await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      }

      const csv = await page.request.get('/api/v1/reports?report=source-analysis&format=csv');
      expect(csv.status()).toBe(200);
      expect(csv.headers()['content-type']).toContain('text/csv');
      // Every cell is quoted since the export moved onto the shared encoder.
      expect(await csv.text()).toContain('"Source","Leads"');
    });

    await test.step('M11 — somebody posts to the feed and reacts to it', async () => {
      await opens(page, '/engagement', 'Engagement');

      const body = `Closed the first one ${run}`;
      await page.getByRole('textbox').first().fill(body);

      const [posted] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/v1/posts') && r.request().method() === 'POST'),
        page.getByRole('button', { name: 'Post' }).click(),
      ]);
      expect(posted.status(), await posted.text()).toBeLessThan(300);

      await expect(page.getByText(body)).toBeVisible();

      // Reacting is the other half of a feed being a feed.
      const [reacted] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/v1/posts') && r.request().method() === 'PATCH'),
        page.getByRole('button', { name: 'celebrate' }).first().click(),
      ]);
      expect(reacted.status(), await reacted.text()).toBeLessThan(300);
      await expect(page.getByRole('button', { name: 'celebrate' }).first()).toHaveAttribute('aria-pressed', 'true');
    });
  });
});
