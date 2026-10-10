/**
 * A bulk stage move from the lead list that the server partly refuses: the bar
 * names the refused lead and repeats the server's sentence, the leads that
 * moved show their new stage, and only the refused one stays selected so a
 * retry does not re-send the ones that worked.
 */
import { test, expect, type Browser } from '@playwright/test';
import { prisma } from '@/lib/db';
import { createWorkspaceViaWizard, login, loginPlatformOwner, strongPassword, uniq } from './helpers';
import { RUN_TAG } from './run-tag';

const workspace = {
  displayName: `Bulk ${RUN_TAG}`,
  slug: `bulk${RUN_TAG}`.toLowerCase(),
  adminName: 'Bulk Admin',
  adminEmail: `bulk-admin-${RUN_TAG}@masterapp.local`,
  adminPassword: strongPassword(`bulk${RUN_TAG}`),
  modules: ['SALES'] as 'SALES'[],
};
const at = (path: string) => `/${workspace.slug}${path}`;
const stageKey = `needs-email-${RUN_TAG}`;

async function signedIn(browser: Browser, email: string, password: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await login(page, email, password);
  return { context, page };
}

test.describe('Bulk stage move from the lead list', () => {
  test.describe.configure({ mode: 'serial' });
  // The workspace is keyed on RUN_TAG so a pinned tag reuses it; the leads are
  // not, since createLead's duplicate rule would 409 on the repeated email.
  const run = uniq();
  let tenantId = '';
  let stageId = '';

  test('a workspace with a stage that needs an email', async ({ browser }) => {
    if (!(await prisma.tenant.findUnique({ where: { slug: workspace.slug } }))) {
      const page = await browser.newPage();
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, workspace);
      await page.close();
    }
    tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: workspace.slug }, select: { id: true } })).id;
    const stage = await prisma.leadStage.upsert({
      where: { tenantId_key: { tenantId, key: stageKey } },
      update: {},
      create: { tenantId, key: stageKey, name: 'Needs email', position: 99, requiredFields: ['email'] },
      select: { id: true },
    });
    stageId = stage.id;
  });

  test('a partial move names the refused lead and repeats the server’s sentence', async ({ browser }) => {
    const admin = await signedIn(browser, workspace.adminEmail, workspace.adminPassword);
    const made = async (data: Record<string, unknown>) => {
      const res = await admin.page.request.post('/api/v1/leads', { data });
      expect(res.status(), await res.text()).toBeLessThan(300);
      return (await res.json()) as { id: string; reference: string };
    };
    const names = [`Bulk A ${run}`, `Bulk B ${run}`];
    const withEmail = await made({
      fullName: names[0],
      phone: `+97150${String(Date.now()).slice(-7)}`,
      email: `a-${run}@masterapp.local`,
    });
    const noEmail = await made({ fullName: names[1], phone: `+97150${String(Date.now() + 1).slice(-7)}` });

    await admin.page.goto(at('/sales/leads'));
    const rowA = admin.page.getByRole('row', { name: new RegExp(names[0]!) });
    const rowB = admin.page.getByRole('row', { name: new RegExp(names[1]!) });
    await rowA.getByRole('checkbox').check();
    await rowB.getByRole('checkbox').check();
    await admin.page.getByRole('button', { name: 'Change stage' }).click();
    // The select sits inside its <label>, so by label rather than by role and name.
    await admin.page.getByLabel('Move to stage').selectOption({ label: 'Needs email' });

    // Filtered by text: Next's route announcer is a second, empty role="alert".
    const alert = admin.page.getByRole('alert').filter({ hasText: 'could not be completed' });
    await expect(alert).toContainText('1 of 2 could not be completed; the other 1 was.', { timeout: 30_000 });
    await expect(alert).toContainText('Needs email needs: email.');
    await expect(alert).toContainText(noEmail.reference);
    await expect(alert).not.toContainText(withEmail.reference);

    // Only the refused lead stays selected; the list has been refreshed around it.
    await expect(rowB.getByRole('checkbox')).toBeChecked();
    await expect(rowA.getByRole('checkbox')).not.toBeChecked();

    const stageOf = async (id: string) =>
      (await prisma.lead.findFirstOrThrow({ where: { tenantId, id }, select: { stageId: true } })).stageId;
    expect(await stageOf(withEmail.id)).toBe(stageId);
    expect(await stageOf(noEmail.id)).not.toBe(stageId);
    await admin.context.close();
  });
});
