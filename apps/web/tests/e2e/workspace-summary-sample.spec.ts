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

/** Measured against the configured viewport: a mobile browser widens innerWidth along with the page. */
const noSidewaysOverflow = (page: Page) =>
  expect
    .poll(async () => (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width)
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
        await expect(page.locator('.lf-app-frame[data-lf-surface="workspace"]')).toHaveCount(1);
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
      // Off the Summary, the same look stays in force: it belongs to the workspace, not the page.
      const radius = () =>
        page
          .locator('.lf-area-tabs')
          .first()
          .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
      expect(await radius()).toBe('12px');
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

      if (process.env.SUMMARY_SHOT_AFTER)
        await desktop.page.screenshot({ path: process.env.SUMMARY_SHOT_AFTER, fullPage: true });
      // The sample applies to the default light theme only; Dark and Glassy keep their own look.
      const tabRadius = () =>
        desktop.page
          .locator('.lf-area-tabs')
          .first()
          .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
      expect(await tabRadius()).toBe('12px');
      await desktop.page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      expect(await tabRadius()).toBe('0px');
      await desktop.page.evaluate(() => document.documentElement.removeAttribute('data-theme'));

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

  test('Inbox: its own title, the caught-up message only when empty, and the Summary shell', async ({ browser }) => {
    test.skip(before, 'recorded on the new build only');
    const agent = await signedIn(browser, agentEmail, agentPassword);
    try {
      await openSummary(agent.page);
      const summaryShell = await shell(agent.page);
      await agent.page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Inbox' }).click();
      await expect(agent.page).toHaveURL(new RegExp(`${at('/notifications')}$`));
      await expect(agent.page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
      await expect(agent.page.getByText("You're all caught up")).toBeVisible();
      await expect(agent.page.getByText('New notifications will appear here.')).toBeVisible();
      await expect(
        agent.page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Inbox' }),
      ).toHaveAttribute('aria-current', 'page');
      expect(await shell(agent.page)).toEqual(summaryShell);
      if (process.env.SURFACE_SHOT_DIR)
        await agent.page.screenshot({ path: `${process.env.SURFACE_SHOT_DIR}/inbox-empty.png` });
      expect(agent.errors).toEqual([]);
    } finally {
      await agent.close();
    }

    const tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: workspace.slug }, select: { id: true } }))
      .id;
    const adminUser = await prisma.user.findFirstOrThrow({
      where: { tenantId, email: workspace.adminEmail },
      select: { id: true },
    });
    await prisma.notification.create({
      data: { tenantId, userId: adminUser.id, kind: 'test', title: `Viewing confirmed ${RUN_TAG}`, body: 'Tomorrow' },
    });
    const admin = await signedIn(browser, workspace.adminEmail, workspace.adminPassword);
    try {
      await admin.page.goto(at('/notifications'));
      await expect(admin.page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible({ timeout: 60_000 });
      await expect(admin.page.locator('.lf-table')).toContainText(`Viewing confirmed ${RUN_TAG}`);
      await expect(admin.page.getByText("You're all caught up")).toHaveCount(0);
    } finally {
      await admin.close();
    }
  });

  test('one shell on list, detail and form screens; the platform console keeps its own', async ({ browser }) => {
    test.skip(before, 'recorded on the new build only');
    const desktop = await signedIn(browser, workspace.adminEmail, workspace.adminPassword);
    const shot = (name: string) =>
      process.env.SURFACE_SHOT_DIR
        ? desktop.page.screenshot({ path: `${process.env.SURFACE_SHOT_DIR}/${name}.png`, fullPage: true })
        : undefined;
    try {
      await openSummary(desktop.page);
      const summaryShell = await shell(desktop.page);
      const sidebar = desktop.page.getByRole('navigation', { name: 'Workspace' });

      // List screen: the grid and its filters still work inside the same shell.
      await sidebar.getByRole('link', { name: 'Leads', exact: true }).click();
      await expect(desktop.page).toHaveURL(new RegExp(`${at('/sales/leads')}$`));
      await expect(desktop.page.getByText('Rana Haddad')).toBeVisible({ timeout: 60_000 });
      expect(await shell(desktop.page)).toEqual(summaryShell);
      await expect(sidebar.getByRole('link', { name: 'Leads', exact: true })).toHaveAttribute('aria-current', 'page');
      await noSidewaysOverflow(desktop.page);
      await shot('leads-list');

      // Detail screen: the sidebar keeps Leads active.
      await desktop.page.getByRole('link', { name: 'Rana Haddad' }).first().click();
      await expect(desktop.page).toHaveURL(new RegExp(`${at('/sales/leads/')}[^/]+$`));
      await expect(desktop.page.getByText('Rana Haddad').first()).toBeVisible({ timeout: 60_000 });
      expect(await shell(desktop.page)).toEqual(summaryShell);
      await expect(sidebar.getByRole('link', { name: 'Leads', exact: true })).toHaveAttribute('aria-current', 'page');
      await noSidewaysOverflow(desktop.page);
      await shot('lead-detail');

      // Form screen: fields stay opaque, focusable and readable.
      await desktop.page.goto(at('/sales/leads/new'));
      const name = desktop.page.getByLabel(/Full name/i);
      await expect(name).toBeVisible({ timeout: 60_000 });
      expect(await shell(desktop.page)).toEqual(summaryShell);
      await name.focus();
      expect(await name.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
      expect(await contrastOf(desktop.page, 'main label')).toBeGreaterThanOrEqual(4.5);
      await desktop.page.setViewportSize({ width: 640, height: 450 });
      await noSidewaysOverflow(desktop.page);
      await shot('lead-new-zoom200');
      expect(desktop.errors).toEqual([]);
    } finally {
      await desktop.close();
    }

    const phone = await signedIn(browser, workspace.adminEmail, workspace.adminPassword, { ...devices['Pixel 7'] });
    try {
      for (const path of ['/notifications', '/sales/leads', '/sales/leads/new']) {
        await phone.page.goto(at(path));
        await expect(phone.page.locator('main h1').first()).toBeVisible({ timeout: 60_000 });
        await noSidewaysOverflow(phone.page);
      }
      if (process.env.SURFACE_SHOT_DIR)
        await phone.page.screenshot({ path: `${process.env.SURFACE_SHOT_DIR}/lead-new-mobile.png` });
    } finally {
      await phone.close();
    }

    const owner = await browser.newPage();
    try {
      await loginPlatformOwner(owner);
      await owner.goto('/platform/workspaces');
      await expect(owner.locator('.lf-app-frame')).toHaveCount(1, { timeout: 60_000 });
      await expect(owner.locator('.lf-app-frame')).not.toHaveAttribute('data-lf-surface', /./);
      expect(await owner.locator('.lf-app-frame').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
        'rgb(238, 242, 247)',
      );
    } finally {
      await owner.close();
    }
  });

  test('every work area opens inside the same shell, without sideways scrolling', async ({ browser }) => {
    test.skip(before, 'recorded on the new build only');
    test.setTimeout(300_000);
    const areas: [string, string][] = [
      ['crm-accounts', '/sales/accounts'],
      ['crm-opportunities', '/sales/opportunities'],
      ['activities', '/sales/activities'],
      ['tasks', '/tasks'],
      ['calls', '/sales/calls'],
      ['coaching', '/sales/coaching'],
      ['property-projects', '/sales/projects'],
      ['property-listings', '/sales/listings'],
      ['marketing-campaigns', '/sales/campaigns'],
      ['people', '/people'],
      ['people-employees', '/people/employees'],
      ['my-hr-leave', '/people/leave'],
      ['finance-collections', '/sales/collections'],
      ['finance-commissions', '/sales/commissions'],
      ['reports', '/sales/reports'],
      ['settings', '/admin/settings'],
      ['settings-users', '/admin/users'],
      ['settings-roles', '/admin/roles'],
    ];
    const dir = process.env.SURFACE_SHOT_DIR;
    for (const profile of [{ viewport: { width: 1280, height: 900 } }, { ...devices['Pixel 7'] }]) {
      const phone = 'isMobile' in profile;
      const { page, errors, close } = await signedIn(browser, workspace.adminEmail, workspace.adminPassword, profile);
      try {
        await openSummary(page);
        const { activeNav: _summaryNav, ...summaryShell } = await shell(page);
        for (const [name, path] of areas) {
          await page.goto(at(path));
          await expect(page.locator('main h1').first(), path).toBeVisible({ timeout: 60_000 });
          await expect(page.getByRole('heading', { name: 'You do not have access to this page' }), path).toHaveCount(0);
          const { activeNav, ...now } = await shell(page);
          expect(now, path).toEqual(summaryShell);
          if (!phone) expect(activeNav, `${path}: a sidebar item is active`).not.toBeNull();
          // The title starts at the content edge, not pushed right by a short count line.
          const [titleLeft, mainLeft] = await page.evaluate(() => [
            document.querySelector('main h1')!.getBoundingClientRect().left,
            document.querySelector('main')!.getBoundingClientRect().left,
          ]);
          expect(titleLeft - mainLeft, `${path}: title indent`).toBeLessThan(40);
          await noSidewaysOverflow(page);
          if (dir)
            await page.screenshot({ path: `${dir}/area-${name}${phone ? '-mobile' : ''}.png`, fullPage: !phone });
        }
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    }
  });
});

/**
 * Phone usability: the defects found on the rolled-out shell, pinned so they stay fixed.
 * Runs after the fixture above (one worker, file order).
 */
test.describe('Workspace on a phone', () => {
  // Common phone screens in CSS pixels; 412×915 is the Pixel 7 the review used.
  const HEIGHTS: Record<number, number> = { 360: 740, 390: 844, 412: 915, 430: 932 };
  const PHONES = [360, 390, 412, 430];
  const phone = (width: number) => ({
    viewport: { width, height: HEIGHTS[width]! },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const shotDir = process.env.MOBILE_SHOT_DIR;

  /** The page is exactly as wide as the screen and not zoomed out to fit something wider. */
  async function fitsScreen(page: Page, label: string) {
    const width = page.viewportSize()!.width;
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: `${label}: page width` })
      .toBeLessThanOrEqual(width);
    const { inner, scale } = await page.evaluate(() => ({
      inner: window.innerWidth,
      scale: window.visualViewport?.scale ?? 1,
    }));
    expect(inner, `${label}: layout viewport`).toBe(width);
    expect(scale, `${label}: viewport scale`).toBe(1);
  }

  /**
   * Every scroll position at which the control's centre is inside the visible content area
   * (below the top bar, above the tab bar) but a tap there would land on something else.
   */
  async function coveredPositions(page: Page, control: ReturnType<Page['locator']>) {
    await control.scrollIntoViewIfNeeded();
    const handle = await control.elementHandle();
    return page.evaluate(async (el) => {
      const top = document.querySelector('.lf-shell-topbar')!.getBoundingClientRect().bottom;
      const bottom = document.querySelector('.lf-tabbar')!.getBoundingClientRect().top;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const covered: { y: number; by: string }[] = [];
      for (let y = 0; y <= max; y += 12) {
        window.scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const box = el!.getBoundingClientRect();
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height / 2;
        if (cy <= top + 1 || cy >= bottom - 1) continue;
        const hit = document.elementFromPoint(cx, cy);
        if (hit && !el!.contains(hit)) covered.push({ y, by: hit.className.toString() || hit.tagName });
      }
      return covered;
    }, handle);
  }

  test('the assistant never covers View all, date fields or Remove, and still opens', async ({ browser }) => {
    test.skip(before, 'recorded on the new build only');
    test.setTimeout(300_000);
    for (const width of PHONES) {
      const { page, errors, close } = await signedIn(
        browser,
        workspace.adminEmail,
        workspace.adminPassword,
        phone(width),
      );
      try {
        const fab = page.locator('.lf-ai-fab');
        // People: "View all" opens its list.
        await page.goto(at('/people'));
        const viewAll = page.getByRole('link', { name: 'View all' }).first();
        await expect(viewAll).toBeVisible({ timeout: 60_000 });
        if (shotDir && width === 390) await page.screenshot({ path: `${shotDir}/people-390.png` });
        expect(await coveredPositions(page, viewAll), `${width}px: View all covered`).toEqual([]);
        const target = await viewAll.getAttribute('href');
        await viewAll.click();
        await expect(page).toHaveURL(new RegExp(`${target!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));

        // Leave: both date fields take a date by tap and keyboard.
        await page.goto(at('/people/leave'));
        for (const name of ['First day', 'Last day']) {
          const field = page.getByLabel(name);
          await expect(field).toBeVisible({ timeout: 60_000 });
          expect(await coveredPositions(page, field), `${width}px: ${name} covered`).toEqual([]);
          await field.click();
          await expect(field).toBeFocused();
          await field.fill('2026-12-01');
          await expect(field).toHaveValue('2026-12-01');
        }
        if (shotDir && width === 390) await page.screenshot({ path: `${shotDir}/leave-390.png` });

        // Users: Remove opens its confirmation, and closes again without removing anyone.
        await page.goto(at('/admin/users'));
        const remove = page.getByRole('button', { name: 'Remove', exact: true }).first();
        await expect(remove).toBeVisible({ timeout: 60_000 });
        expect(await coveredPositions(page, remove), `${width}px: Remove covered`).toEqual([]);
        await remove.click();
        await expect(page.getByText(/^Remove .+ from this workspace$/)).toBeVisible();
        await remove.click();
        await expect(page.getByText(/^Remove .+ from this workspace$/)).toHaveCount(0);
        if (shotDir && width === 390) await page.screenshot({ path: `${shotDir}/users-390.png` });

        // The assistant sits in the tab bar, below every sheet, and still opens and closes.
        const [fabBox, barBox] = [await fab.boundingBox(), await page.locator('.lf-tabbar').boundingBox()];
        expect(fabBox!.y, `${width}px: assistant inside the tab bar`).toBeGreaterThanOrEqual(barBox!.y - 1);
        await page.getByRole('button', { name: /^Filters/ }).click();
        const onTop = await fab.evaluate((el) => {
          const b = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2));
        });
        expect(onTop, `${width}px: assistant above an open sheet`).toBe(false);
        await page.keyboard.press('Escape');
        await fab.click();
        const panel = page.getByRole('dialog', {
          name: await fab.evaluate((el) => el.getAttribute('aria-label')!.slice(5)),
        });
        await expect(panel).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(fab).toBeVisible();
        await fitsScreen(page, `${width}px users`);
        expect(errors).toEqual([]);
      } finally {
        await close();
      }
    }
  });

  test('secondary view tabs and header actions stay inside the content edges', async ({ browser }) => {
    test.skip(before, 'recorded on the new build only');
    test.setTimeout(300_000);
    const sizes = [
      ...PHONES.map(phone),
      { viewport: { width: 768, height: 1024 } },
      { viewport: { width: 1280, height: 900 } },
    ];
    for (const profile of sizes) {
      const width = profile.viewport.width;
      const { page, close } = await signedIn(browser, workspace.adminEmail, workspace.adminPassword, profile);
      try {
        for (const [path, strip, second, key] of [
          ['/sales/activities', 'Activity type', 'Calls', 'tab=CALL'],
          ['/sales/calls', 'Call filter', null, null],
        ] as const) {
          await page.goto(at(path));
          const views = page.getByRole('navigation', { name: strip });
          await expect(views).toBeVisible({ timeout: 60_000 });
          await fitsScreen(page, `${width}px ${path}`);
          const edges = await page.evaluate(() => {
            const h1 = document.querySelector('main h1')!.getBoundingClientRect();
            const tabs = document.querySelector('.lf-area-tabs')?.getBoundingClientRect();
            return {
              left: h1.left,
              right: tabs ? tabs.right : document.querySelector('main')!.getBoundingClientRect().right,
            };
          });
          // The strip scrolls inside itself; its box stays within the content column.
          const box = (await views.boundingBox())!;
          expect(box.x, `${width}px ${path}: view tabs left edge`).toBeGreaterThanOrEqual(edges.left - 1);
          expect(box.x + box.width, `${width}px ${path}: view tabs right edge`).toBeLessThanOrEqual(edges.right + 1);
          // Header actions line up with the title and wrap inside the column.
          for (const action of await page.locator('.lf-list-header__actions > *').all()) {
            const a = await action.boundingBox();
            if (!a || a.width === 0) continue;
            expect(a.x, `${width}px ${path}: action left`).toBeGreaterThanOrEqual(edges.left - 1);
            expect(a.x + a.width, `${width}px ${path}: action right`).toBeLessThanOrEqual(edges.right + 1);
          }
          // Work-area tabs and view tabs look different: a filled active tab against an underlined one.
          const [primary, secondary] = await page.evaluate(
            ([name]) => {
              const bg = (el: Element | null) => (el ? getComputedStyle(el).backgroundColor : null);
              return [
                bg(document.querySelector('.lf-area-tabs .lf-tab[aria-current="page"]')),
                bg(document.querySelector(`nav[aria-label="${name}"] .lf-tab[aria-selected="true"]`)),
              ];
            },
            [strip],
          );
          expect(primary, `${width}px ${path}: distinct active tabs`).not.toBe(secondary);
          if (second) {
            await views.getByRole('tab', { name: second }).click();
            await expect(page).toHaveURL(new RegExp(`${key}$`));
            await expect(views.getByRole('tab', { name: second })).toHaveAttribute('aria-selected', 'true');
            await page.goBack();
            await expect(views.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
            await fitsScreen(page, `${width}px ${path} after back`);
          }
          if (shotDir && width === 390) await page.screenshot({ path: `${shotDir}/${path.split('/').pop()}-390.png` });
        }
        await page.goto(at('/sales/accounts'));
        await expect(page.locator('main h1')).toBeVisible({ timeout: 60_000 });
        await fitsScreen(page, `${width}px accounts`);
        const [title, search] = await Promise.all([
          page.locator('main h1').boundingBox(),
          page.getByRole('searchbox', { name: 'Search accounts' }).boundingBox(),
        ]);
        if (width <= 760)
          expect(Math.abs(search!.x - title!.x), `${width}px: search aligned with title`).toBeLessThanOrEqual(1);
        if (shotDir && width === 390) await page.screenshot({ path: `${shotDir}/accounts-390.png` });
      } finally {
        await close();
      }
    }
  });

  test('Settings tabs: the active tab is in view on direct links, clicks and back/forward, without page scroll', async ({
    browser,
  }) => {
    test.skip(before, 'recorded on the new build only');
    test.setTimeout(240_000);
    for (const profile of [
      phone(360),
      phone(430),
      { viewport: { width: 768, height: 1024 } },
      { viewport: { width: 1280, height: 900 } },
    ]) {
      const width = profile.viewport.width;
      const { page, close } = await signedIn(browser, workspace.adminEmail, workspace.adminPassword, profile);
      const strip = page.getByRole('navigation', { name: 'Settings screens' });
      const activeInView = async (label: string, name: string) => {
        await expect(strip.locator('[aria-current="page"]'), label).toHaveText(name);
        await expect
          .poll(
            () =>
              strip.evaluate((nav) => {
                const tab = nav.querySelector('[aria-current="page"]')!.getBoundingClientRect();
                const box = nav.getBoundingClientRect();
                return tab.left >= box.left - 1 && tab.right <= box.right + 1;
              }),
            { message: `${width}px ${label}: active tab within the strip` },
          )
          .toBe(true);
        expect(await page.evaluate(() => window.scrollY), `${width}px ${label}: no page scroll`).toBe(0);
        await fitsScreen(page, `${width}px ${label}`);
      };
      try {
        await page.goto(at('/admin/audit'));
        await expect(strip).toBeVisible({ timeout: 60_000 });
        await activeInView('direct link', 'Audit Log');
        // More tabs exist before it, and the strip says so.
        await expect(strip).toHaveAttribute('data-more', /start/);
        if (shotDir && width === 360) await page.screenshot({ path: `${shotDir}/settings-audit-360.png` });

        await page.goto(at('/admin/settings'));
        await activeInView('first tab', 'Workspace');
        if (await strip.evaluate((nav) => nav.scrollWidth > nav.clientWidth))
          await expect(strip).toHaveAttribute('data-more', /end/);

        // Keyboard: a focused tab is scrolled into the strip, and Enter opens it.
        const roles = strip.getByRole('link', { name: 'Roles', exact: true });
        await roles.focus();
        await expect(roles).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`${at('/admin/roles')}$`));
        await activeInView('after keyboard', 'Roles');

        await strip.getByRole('link', { name: 'Audit Log', exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${at('/admin/audit')}$`));
        await activeInView('after click', 'Audit Log');
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`${at('/admin/roles')}$`));
        await activeInView('back', 'Roles');
        await page.goBack();
        await activeInView('back to first', 'Workspace');
        await page.goForward();
        await activeInView('forward', 'Roles');
      } finally {
        await close();
      }
    }
  });

  test('Coaching filters and Roles assignment history sit on panels', async ({ browser }) => {
    test.skip(before, 'recorded on the new build only');
    const { page, close } = await signedIn(browser, workspace.adminEmail, workspace.adminPassword, phone(390));
    try {
      await page.goto(at('/sales/coaching'));
      const filters = page.locator('form[method="get"]').filter({ has: page.getByRole('button', { name: 'Filter' }) });
      await expect(filters).toBeVisible({ timeout: 60_000 });
      await expect(filters).toHaveClass(/lf-card/);
      await fitsScreen(page, 'coaching');
      if (shotDir) await page.screenshot({ path: `${shotDir}/coaching-390.png` });
      await page.goto(at('/admin/roles'));
      const history = page.getByRole('heading', { name: 'Assignment history' });
      await expect(history).toBeVisible({ timeout: 60_000 });
      await expect(history.locator('xpath=following-sibling::*[1]')).toHaveClass(/lf-card/);
      await fitsScreen(page, 'roles');
    } finally {
      await close();
    }
  });

  test('a restricted role is still refused Settings and finance, on a phone', async ({ browser }) => {
    const { page, close } = await signedIn(browser, agentEmail, agentPassword, phone(390));
    try {
      for (const path of ['/admin/users', '/admin/roles', '/sales/collections']) {
        await page.goto(at(path));
        await expect(page.getByRole('heading', { name: 'You do not have access to this page' }), path).toBeVisible({
          timeout: 60_000,
        });
      }
      expect((await page.request.get('/api/v1/leadership?view=pl')).status()).toBe(403);
      await page.goto(at('/sales/leads'));
      await expect(page.getByRole('heading', { level: 1, name: 'Leads' })).toBeVisible({ timeout: 60_000 });
    } finally {
      await close();
    }
  });
});

/** The shell's computed look: equal on two screens means no visual switch between them. */
function shell(page: Page) {
  return page.evaluate(() => {
    const style = (selector: string) => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el) : null;
    };
    const frame = style('.lf-app-frame');
    const sidebar = style('.lf-workspace-sidebar');
    const topbar = style('.lf-shell-topbar');
    const active = style('.lf-workspace-sidebar .lf-nav-link[aria-current="page"]');
    return {
      canvas: frame && `${frame.backgroundColor} ${frame.backgroundImage}`,
      sidebar: sidebar && `${sidebar.backgroundImage} ${sidebar.borderRightColor}`,
      topbar: topbar && `${topbar.height} ${topbar.backgroundColor} ${topbar.boxShadow}`,
      activeNav: active && `${active.backgroundColor} ${active.borderRadius} ${active.boxShadow}`,
      pagePadding: style('.lf-page-main')?.paddingTop,
    };
  });
}
