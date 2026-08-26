import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createWorkspaceViaWizard, login, loginPlatformOwner, logout, strongPassword, uniq } from './helpers';

/**
 * Clicking a record opens that record's screen — from wherever you clicked.
 *
 * Two defects lived here, and both were invisible until somebody clicked:
 *
 *   1. `Notification.actionUrl` stored bare paths — `/people/overtime`,
 *      `/social-leads/{id}` — which the bell pushed verbatim. No workspace slug,
 *      and in the social case no such route under any prefix, so every one of
 *      those clicks reached the 404 page. The feed resolves a destination on
 *      read now, from the record's type and the slug of the workspace that owns
 *      it, which is why the rows written before the fix work too.
 *
 *   2. The sidebar and top bar decided the active module with
 *      `pathname.includes('/people')`. That is a substring, so it matched
 *      `/{slug}/sales/people` — a Sales screen — and every screen of any
 *      workspace whose slug contains the word. The slug below contains it
 *      deliberately: `peoplefirst-…` is not a contrived name, and before the fix
 *      it put the HR navigation on this workspace's Leads list.
 *
 * One test, like `modules.spec.ts` and `hr-modules.spec.ts`. Every sign-in in
 * this suite spends the shared per-IP throttle bucket, so a spec that logs in
 * once per assertion starves the specs that run after it.
 */
test.describe('Clicking a record opens that record', () => {
  const run = uniq();

  const workspace = {
    // The substring is the point. A real tenant may well be called this.
    displayName: `Peoplefirst Realty ${run}`,
    slug: `peoplefirst-${run}`,
    adminName: 'Peoplefirst Administrator',
    adminEmail: `admin.nav.${run}@masterapp.local`,
    adminPassword: strongPassword(`nav${run}`),
    modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
  };

  /**
   * The three things that independently decide "which module is this", each
   * asserted where it is actually decided.
   *
   * `data-lf-module` is stamped by ModuleTheme in an effect, so it appears only
   * once the page has hydrated; the other two are server-rendered markup. An
   * auto-retrying assertion covers both without a sleep.
   */
  async function expectSalesShell(page: Page) {
    await expect(page.locator('html')).toHaveAttribute('data-lf-module', 'sales');
    // The search box renders only when the top bar thinks it is not in People.
    await expect(page.getByRole('search')).toBeVisible();
    // A Sales-only sidebar entry; the People navigation has no Opportunities.
    await expect(page.getByRole('link', { name: 'Opportunities', exact: true })).toBeVisible();
  }

  /**
   * Three notifications in the shape the services write them: a type and a
   * record id, and no path at all.
   *
   * Tenant is exempt from row-level security; User, Lead and Notification are
   * not. A raw client with no `app.tenant_id` set reads nothing from them and
   * writes nothing to them, so this runs inside one transaction with the setting
   * applied — the same thing `withTx` does for the application.
   */
  async function seedNotifications(): Promise<{ leadId: string }> {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
    let leadId = '';
    try {
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: workspace.slug } });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        const admin = await tx.user.findFirstOrThrow({
          where: { tenantId: tenant.id, email: workspace.adminEmail },
        });
        const lead = await tx.lead.findFirst({ where: { tenantId: tenant.id }, select: { id: true } });
        leadId = lead?.id ?? '';

        await tx.notification.createMany({
          data: [
            {
              tenantId: tenant.id,
              userId: admin.id,
              kind: 'leave.requested',
              title: `Leave to approve ${run}`,
              objectType: 'hr_leave_request',
              recordId: 'rec-leave',
            },
            {
              tenantId: tenant.id,
              userId: admin.id,
              kind: 'SOCIAL_ENQUIRY',
              title: `Social enquiry ${run}`,
              objectType: 'SOCIAL_COMMENT',
              recordId: 'rec-social',
            },
            ...(leadId
              ? [
                  {
                    tenantId: tenant.id,
                    userId: admin.id,
                    kind: 'AUTOMATION',
                    title: `Automation ${run}`,
                    // Upper case, as the automation engine writes it.
                    objectType: 'LEAD',
                    recordId: leadId,
                  },
                ]
              : []),
          ],
        });
      });
    } finally {
      await prisma.$disconnect();
    }
    return { leadId };
  }

  test('a record opens from the bell, and the shell agrees on the module', async ({ page }) => {
    await loginPlatformOwner(page);
    await createWorkspaceViaWizard(page, workspace);
    await logout(page);

    const { leadId } = await seedNotifications();

    await login(page, workspace.adminEmail, workspace.adminPassword);
    await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/`));

    // ── The shell, in a workspace whose slug contains "people" ──────────────
    // All three module decisions have to say Sales; two said People before.
    await page.goto(`/${workspace.slug}/sales/leads`);
    await expectSalesShell(page);

    // And the route that collides on its own: /{slug}/sales/people is a Sales
    // screen whose last segment is the other module's name.
    await page.goto(`/${workspace.slug}/sales/people`);
    await expectSalesShell(page);

    // The People module still resolves as People — this is a narrower test, not
    // a disabled one.
    await page.goto(`/${workspace.slug}/people/leave`);
    await expect(page.locator('html')).toHaveAttribute('data-lf-module', 'people');
    await expect(page.getByRole('search')).toHaveCount(0);

    // ── The bell, on the module that raises most of the notifications ───────
    // It always rendered here — `hidden` lost to `.lf-shell-actions { display:
    // flex }` — but its unread count was fetched only on Sales, so it was a
    // permanently empty bell on the module that fills it.
    await expect(page.getByRole('button', { name: /Notifications/ })).toBeVisible();

    // ── What the feed hands the client ─────────────────────────────────────
    // Every destination is workspace-prefixed; no row carries an actionUrl.
    await page.goto(`/${workspace.slug}/sales/leads`);
    const feed = await page.request.get('/api/v1/notifications');
    expect(feed.ok(), await feed.text()).toBe(true);
    const rows: { title: string; destination: string | null; actionUrl: string | null }[] = (await feed.json()).data;
    const find = (title: string) => rows.find((r) => r.title === title)!;

    expect(find(`Leave to approve ${run}`).destination).toBe(`/${workspace.slug}/people/leave`);
    expect(find(`Leave to approve ${run}`).actionUrl).toBeNull();
    expect(find(`Social enquiry ${run}`).destination).toBe(`/${workspace.slug}/sales/social-leads`);
    if (leadId) {
      expect(find(`Automation ${run}`).destination).toBe(`/${workspace.slug}/sales/leads/${leadId}`);
    }

    // ── And the click itself ───────────────────────────────────────────────
    const visited: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
    });

    await page.getByRole('button', { name: /Notifications/ }).click();
    // Opening the dropdown is not a navigation; anything recorded up to here is
    // the page the click starts from, which is not what this measures.
    visited.length = 0;

    await page.getByText(`Leave to approve ${run}`).click();
    await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/people/leave$`));

    // Exactly one navigation, to the screen the record lives on. Nothing routed
    // through the 404 page and nothing flashed an unrelated screen on the way —
    // the defect this replaces put every one of these on /not-found.
    expect(visited).toEqual([`/${workspace.slug}/people/leave`]);
  });
});
