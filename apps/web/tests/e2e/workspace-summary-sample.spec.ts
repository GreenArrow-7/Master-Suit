/**
 * Workspace Summary visual sample: the page still says and does what it did.
 *
 * The sample restyles one page and the shell around it, scoped by a marker the
 * page renders. This spec pins what must not change with it: every summary
 * value, section, attention link and table row for the same data; the shell's
 * sidebar, tabs, search, notifications and drawer; role visibility; and it
 * checks what a visual change can break — overflow, focus, contrast on the
 * frosted surfaces, and console errors.
 *
 * Before/after comparison across builds (local, optional):
 *   SUMMARY_PHASE=before  SUMMARY_SNAPSHOT_OUT=file  records values on the old build
 *   SUMMARY_SNAPSHOT_IN=file                         asserts the new build matches
 * With E2E_RUN_TAG fixed and E2E_KEEP_DATA=true on the first run, both runs read
 * the same workspace; the second run's teardown removes it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect, devices, type Browser, type Page } from '@playwright/test';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { createWorkspaceViaWizard, login, loginPlatformOwner, resetLoginThrottle, strongPassword } from './helpers';
import { RUN_TAG } from './run-tag';

const before = process.env.SUMMARY_PHASE === 'before';
const workspace = {
  displayName: `Summary ${RUN_TAG}`,
  slug: `sum${RUN_TAG}`.toLowerCase(),
  adminName: 'Summary Admin',
  adminEmail: `sum-admin-${RUN_TAG}@masterapp.local`,
  adminPassword: strongPassword(`sum${RUN_TAG}`),
  modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
};
const agentEmail = `sum-agent-${RUN_TAG}@masterapp.local`;
const agentPassword = strongPassword(`suma${RUN_TAG}`);
const at = (path: string) => `/${workspace.slug}${path}`;

async function signedIn(
  browser: Browser,
  email: string,
  password: string,
  profile?: Parameters<Browser['newContext']>[0],
) {
  const context = await browser.newContext(profile ?? { viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await resetLoginThrottle();
  await login(page, email, password);
  return { page, errors, close: () => context.close() };
}

async function openSummary(page: Page) {
  await page.goto(at('/dashboard'));
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 60_000 });
}

/** Everything the page reports, minus the time-of-day greeting. */
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main')!;
    return {
      scope: text(main.querySelector('.lf-dash-meta')),
      kpis: [...main.querySelectorAll('.lf-kpi')].map((a) => ({
        label: text(a.querySelector('.lf-kpi__label')),
        value: text(a.querySelector('.lf-kpi__value')),
        href: a.getAttribute('href'),
      })),
      attention: [...main.querySelectorAll('.lf-attn__row')].map((a) => ({
        count: text(a.querySelector('.lf-attn__count')),
        label: text(a.querySelector('.lf-attn__label')),
        hint: text(a.querySelector('.lf-attn__hint')),
        tone: a.getAttribute('data-tone'),
        href: a.getAttribute('href'),
      })),
      headings: [...main.querySelectorAll('h2')].map(text),
      panels: [...main.querySelectorAll('.lf-kv > div')].map(
        (row) => `${text(row.querySelector('dt'))}=${text(row.querySelector('dd'))}`,
      ),
      tableRows: [...main.querySelectorAll('.lf-table tbody tr')].map(text),
      links: [...main.querySelectorAll('a')].map((a) => `${text(a)} → ${a.getAttribute('href')}`),
      insight: text(main.querySelector('.lf-ai-surface')),
    };
  });
}

/** WCAG contrast of an element's text against its composited background colours. */
async function contrastOf(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const parse = (value: string) => {
        const m = value.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const [r, g, b, a = '1'] = m[1]!.split(/[ ,/]+/).filter(Boolean);
        return [Number(r), Number(g), Number(b), Number(a)];
      };
      const layers: number[][] = [];
      for (let node: Element | null = el; node; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg && bg[3]! > 0) layers.push(bg);
        if (bg && bg[3] === 1) break;
      }
      let base = [255, 255, 255];
      for (const layer of layers.reverse()) base = base.map((c, i) => layer[i]! * layer[3]! + c * (1 - layer[3]!));
      const fg = parse(getComputedStyle(el).color)!;
      const ink = base.map((c, i) => fg[i]! * fg[3]! + c * (1 - fg[3]!));
      const lum = (rgb: number[]) => {
        const [r, g, b] = rgb.map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const [hi, lo] = [lum(ink), lum(base)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    });
}

const noSidewaysOverflow = (page: Page) =>
  expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0);

test.describe('Workspace Summary sample', () => {
  test.describe.configure({ mode: 'serial' });

  test('a workspace with pipeline, queues, follow-ups and an AI-scored call', async ({ browser }) => {
    if (await prisma.tenant.findUnique({ where: { slug: workspace.slug }, select: { id: true } })) return;
    const page = await browser.newPage();
    await resetLoginThrottle();
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    await page.close();

    const tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: workspace.slug }, select: { id: true } }))
      .id;
    const { page: admin, close } = await signedIn(browser, workspace.adminEmail, workspace.adminPassword);
    try {
      const post = async (path: string, data: unknown) => {
        const res = await admin.request.post(path, { data });
        expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
        return res.json();
      };
      const leads: string[] = [];
      for (const [i, name] of ['Rana Haddad', 'Omar Siddiqui', 'Lena Fischer', 'Arjun Mehta', 'Sara Nasser'].entries())
        leads.push((await post('/api/v1/leads', { fullName: name, phone: `+9715055501${i}` })).id);
      // Two leads with nobody on them: the triage queue.
      await prisma.lead.updateMany({ where: { tenantId, id: { in: leads.slice(3) } }, data: { ownerId: null } });
      const day = 86_400_000;
      await post('/api/v1/follow-ups', {
        leadId: leads[0],
        title: 'Send the payment plan',
        dueAt: new Date(Date.now() - 2 * day),
        priority: 'HIGH',
      });
      await post('/api/v1/follow-ups', {
        leadId: leads[1],
        title: 'Confirm the viewing time',
        dueAt: new Date(Date.now() - 3_600_000),
        priority: 'URGENT',
      });
      await post('/api/v1/follow-ups', {
        leadId: leads[2],
        title: 'Share floor plans',
        dueAt: new Date(Date.now() + 2 * day),
        priority: 'MEDIUM',
      });
      const taskType = await prisma.taskType.findFirstOrThrow({ where: { tenantId }, select: { id: true } });
      await post('/api/v1/tasks', {
        typeId: taskType.id,
        title: 'Prepare the offer letter',
        dueAt: new Date(),
        leadId: leads[0],
      });
      await post('/api/v1/opportunities', { name: 'Marina 2BR', leadId: leads[0], amount: 1_850_000 });
      await post('/api/v1/opportunities', { name: 'Downtown villa', leadId: leads[1], amount: 4_200_000 });

      const adminUser = await prisma.user.findFirstOrThrow({
        where: { tenantId, email: workspace.adminEmail },
        select: { id: true },
      });
      const scorecard = await prisma.auditScorecard.create({ data: { tenantId, name: 'Discovery call' } });
      const call = await prisma.call.create({ data: { tenantId, callerId: adminUser.id, startedAt: new Date() } });
      await prisma.callAudit.create({
        data: {
          tenantId,
          callId: call.id,
          scorecardId: scorecard.id,
          status: 'COMPLETED',
          humanReviewed: false,
          overallScore: 34,
          maxScore: 40,
        },
      });

      // An agent who sees only their own work, for role visibility.
      const role = await prisma.role.create({
        data: { tenantId, key: `sum-agent-${RUN_TAG}`, name: 'Summary agent', rank: 60, defaultScope: 'OWN' },
      });
      for (const [module, action] of [
        ['leads', 'VIEW'],
        ['leads', 'EDIT'],
        ['opportunities', 'VIEW'],
        ['tasks', 'VIEW'],
        ['calls', 'VIEW'],
      ] as const) {
        const permission = await prisma.permission.findUniqueOrThrow({ where: { module_action: { module, action } } });
        await prisma.rolePermission.create({
          data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope: 'OWN' },
        });
      }
      const platformUser = await prisma.platformUser.create({
        data: {
          email: agentEmail,
          normalizedEmail: agentEmail,
          fullName: 'Summary Agent',
          status: 'ACTIVE',
          passwordHash: await hashPassword(agentPassword),
          passwordChangedAt: new Date(),
          emailVerifiedAt: new Date(),
        },
      });
      const user = await prisma.user.create({
        data: { tenantId, email: agentEmail, fullName: 'Summary Agent', roleId: role.id, status: 'ACTIVE' },
      });
      await prisma.workspaceMembership.create({
        data: {
          tenantId,
          platformUserId: platformUser.id,
          salesUserId: user.id,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
    } finally {
      await close();
    }
  });

  test('the same values, sections, links and rows as before, and no new console errors', async ({ browser }) => {
    const { page, errors, close } = await signedIn(browser, workspace.adminEmail, workspace.adminPassword);
    try {
      await openSummary(page);
      const now = await snapshot(page);
      expect(now.kpis.length).toBeGreaterThan(0);
      expect(now.attention.map((a) => a.label)).toEqual(
        expect.arrayContaining(['Overdue follow-ups', 'Unassigned leads']),
      );
      expect(now.tableRows.length).toBeGreaterThan(0);
      if (process.env.SUMMARY_SHOT) await page.screenshot({ path: process.env.SUMMARY_SHOT, fullPage: true });
      const record = { ...now, consoleErrors: errors };
      if (process.env.SUMMARY_SNAPSHOT_OUT)
        writeFileSync(process.env.SUMMARY_SNAPSHOT_OUT, JSON.stringify(record, null, 2));
      if (process.env.SUMMARY_SNAPSHOT_IN) {
        const earlier = JSON.parse(readFileSync(process.env.SUMMARY_SNAPSHOT_IN, 'utf8'));
        const { consoleErrors: earlierErrors, ...earlierContent } = earlier;
        expect(now).toEqual(earlierContent);
        expect(errors.length).toBeLessThanOrEqual(earlierErrors.length);
      }
      if (!before) {
        await expect(page.locator('[data-lf-sample="summary-glass"]')).toHaveCount(1);
        expect(errors).toEqual([]);
      }
    } finally {
      await close();
    }
  });

  test('each attention row opens the view it names', async ({ browser }) => {
    const { page, close } = await signedIn(browser, workspace.adminEmail, workspace.adminPassword);
    try {
      await openSummary(page);
      const rows = await page.locator('.lf-attn__row').evaluateAll((els) => els.map((a) => a.getAttribute('href')!));
      for (const [i, href] of rows.entries()) {
        await page.locator('.lf-attn__row').nth(i).click();
        await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
        await expect(page.getByRole('heading', { name: 'You do not have access to this page' })).toHaveCount(0);
        await page.goBack();
        await expect(page.locator('.lf-attn__row').first()).toBeVisible();
      }
    } finally {
      await close();
    }
  });

  test('the shell still works: sidebar, tabs, search, notifications', async ({ browser }) => {
    test.skip(before, 'recorded on the new build only');
    const { page, close } = await signedIn(browser, workspace.adminEmail, workspace.adminPassword);
    try {
      await openSummary(page);
      const tabs = page.getByRole('navigation', { name: 'My Workspace screens' });
      await expect(tabs.locator('[aria-current="page"]')).toHaveText('Workspace Summary');
      await tabs.getByRole('link', { name: 'Sales Overview' }).click();
      await expect(page).toHaveURL(new RegExp(`${at('/sales')}$`));
      await page.goBack();

      await page.getByRole('button', { name: 'Search and jump to any page' }).click();
      await page.getByRole('combobox', { name: 'Jump to a page or search' }).fill('recovery cases');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/sales\/collections\/recovery$/);
      await page.goBack();

      await page.getByRole('button', { name: /^Notifications/ }).click();
      await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
      await page.keyboard.press('Escape');

      await page
        .getByRole('navigation', { name: 'Workspace' })
        .getByRole('link', { name: 'Leads', exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`${at('/sales/leads')}$`));
      // Off the Summary, the sample is not in force.
      await expect(page.locator('[data-lf-sample="summary-glass"]')).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test('an agent still sees only their own figures and no administration panels', async ({ browser }) => {
    const { page, close } = await signedIn(browser, agentEmail, agentPassword);
    try {
      await openSummary(page);
      await expect(page.locator('.lf-kpi__label').first()).toContainText(/^My /);
      for (const title of ['Subscription', 'Security today', 'People summary'])
        await expect(page.getByRole('heading', { name: title })).toHaveCount(0);
      await expect(page.locator('.lf-attn__row', { hasText: 'Failed sign-ins today' })).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test('readable, focusable and not wider than the screen at every width', async ({ browser }) => {
    test.skip(before, 'recorded on the new build only');
    const desktop = await signedIn(browser, workspace.adminEmail, workspace.adminPassword);
    try {
      await openSummary(desktop.page);
      await noSidewaysOverflow(desktop.page);
      for (const selector of [
        '.lf-kpi__label',
        '.lf-kpi__value',
        '.lf-attn__label',
        '.lf-attn__hint',
        '.lf-dash-meta',
        '.lf-kv dt',
        '.lf-area-tabs .lf-tab[aria-current="page"]',
        '.lf-area-tabs .lf-tab:not([aria-current])',
        '.lf-nav-link[aria-current="page"]',
        '.lf-nav-link:not([aria-current])',
        '.lf-cmdk-trigger span',
      ])
        expect(await contrastOf(desktop.page, selector), selector).toBeGreaterThanOrEqual(4.5);

      // Keyboard focus is visible on the page's own actions.
      await desktop.page.locator('.lf-attn__row').first().focus();
      const ring = await desktop.page
        .locator('.lf-attn__row')
        .first()
        .evaluate((el) => {
          const s = getComputedStyle(el);
          return `${s.outlineStyle} ${s.outlineWidth} ${s.boxShadow}`;
        });
      expect(ring).not.toMatch(/^none 0px none$/);

      // Status is named in words, not only coloured.
      for (const row of await desktop.page.locator('.lf-attn__row .lf-attn__label').allTextContents())
        expect(row.trim()).not.toBe('');
      if (process.env.SUMMARY_SHOT_AFTER)
        await desktop.page.screenshot({ path: process.env.SUMMARY_SHOT_AFTER, fullPage: true });

      // 200% browser zoom on a 1280px window is a 640px CSS viewport.
      await desktop.page.setViewportSize({ width: 640, height: 450 });
      await noSidewaysOverflow(desktop.page);
      await desktop.page.setViewportSize({ width: 820, height: 1100 });
      await noSidewaysOverflow(desktop.page);
    } finally {
      await desktop.close();
    }

    const phone = await signedIn(browser, workspace.adminEmail, workspace.adminPassword, { ...devices['Pixel 7'] });
    try {
      await openSummary(phone.page);
      await noSidewaysOverflow(phone.page);
      const rowHeight = await phone.page
        .locator('.lf-attn__row')
        .first()
        .evaluate((el) => el.getBoundingClientRect().height);
      expect(rowHeight).toBeGreaterThanOrEqual(44);
      if (process.env.SUMMARY_SHOT_MOBILE)
        await phone.page.screenshot({ path: process.env.SUMMARY_SHOT_MOBILE, fullPage: false });
      await phone.page.locator('.lf-mobile-nav-button').click();
      await expect(phone.page.locator('.lf-workspace-sidebar')).toBeInViewport();
      await phone.page
        .getByRole('navigation', { name: 'Workspace' })
        .getByRole('link', { name: 'Collections', exact: true })
        .click();
      await expect(phone.page).toHaveURL(/\/sales\/collections$/);
      expect(phone.errors).toEqual([]);
    } finally {
      await phone.close();
    }
  });
});
