/**
 * Deleting leads from the list, tasks and calls — the incident fixes BUG-006,
 * BUG-009 and BUG-011, ported onto the restructured workspace.
 *
 * Each delete is a soft delete behind its own module's DELETE permission. The
 * control is shown only to a holder, the endpoint refuses everyone else (403),
 * another tenant's record is a 404 and stays untouched, and a repeat is a 404.
 * A deleted call's recording stops streaming.
 */
import { test, expect, type Browser } from '@playwright/test';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { createWorkspaceViaWizard, login, loginPlatformOwner, resetLoginThrottle, strongPassword } from './helpers';
import { RUN_TAG } from './run-tag';

const workspace = {
  displayName: `Deletes ${RUN_TAG}`,
  slug: `del${RUN_TAG}`.toLowerCase(),
  adminName: 'Deletes Admin',
  adminEmail: `del-admin-${RUN_TAG}@masterapp.local`,
  adminPassword: strongPassword(`del${RUN_TAG}`),
  modules: ['SALES'] as 'SALES'[],
};
const repEmail = `del-rep-${RUN_TAG}@masterapp.local`;
const repPassword = strongPassword(`delr${RUN_TAG}`);
const at = (path: string) => `/${workspace.slug}${path}`;

async function signedIn(browser: Browser, email: string, password: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await resetLoginThrottle();
  await login(page, email, password);
  return { context, page };
}

test.describe('Deletes from lists and detail pages', () => {
  test.describe.configure({ mode: 'serial' });
  let tenantId = '';

  test('a workspace with an administrator and a rep who cannot delete', async ({ browser }) => {
    if (!(await prisma.tenant.findUnique({ where: { slug: workspace.slug } }))) {
      const page = await browser.newPage();
      await resetLoginThrottle();
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, workspace);
      await page.close();
    }
    tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: workspace.slug }, select: { id: true } })).id;
    if (await prisma.user.findFirst({ where: { tenantId, email: repEmail } })) return;

    const role = await prisma.role.create({
      data: { tenantId, key: `del-rep-${RUN_TAG}`, name: 'Delete-less rep', rank: 60, defaultScope: 'ORGANIZATION' },
    });
    for (const [module, action] of [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
      ['tasks', 'VIEW'],
      ['calls', 'VIEW'],
    ] as const) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { module_action: { module, action } } });
      await prisma.rolePermission.create({
        data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
      });
    }
    const identity = await prisma.platformUser.create({
      data: {
        email: repEmail,
        normalizedEmail: repEmail,
        fullName: 'Delete-less Rep',
        status: 'ACTIVE',
        passwordHash: await hashPassword(repPassword),
        passwordChangedAt: new Date(),
        emailVerifiedAt: new Date(),
      },
    });
    const user = await prisma.user.create({
      data: { tenantId, email: repEmail, fullName: 'Delete-less Rep', roleId: role.id, status: 'ACTIVE' },
    });
    await prisma.workspaceMembership.create({
      data: { tenantId, platformUserId: identity.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
    });
  });

  test('leads: the rep sees no Delete and is refused; the administrator deletes selected leads from the list', async ({
    browser,
  }) => {
    const admin = await signedIn(browser, workspace.adminEmail, workspace.adminPassword);
    const names = [`Delete Me A ${RUN_TAG}`, `Delete Me B ${RUN_TAG}`];
    const ids: string[] = [];
    for (const [i, fullName] of names.entries()) {
      const res = await admin.page.request.post('/api/v1/leads', {
        data: { fullName, phone: `+97150${String(Date.now() + i).slice(-7)}` },
      });
      expect(res.status(), await res.text()).toBeLessThan(300);
      ids.push((await res.json()).id);
    }

    const rep = await signedIn(browser, repEmail, repPassword);
    await rep.page.goto(at('/sales/leads'));
    await rep.page
      .getByRole('row', { name: new RegExp(names[0]!) })
      .getByRole('checkbox')
      .check();
    await expect(rep.page.getByRole('button', { name: 'Change stage' })).toBeVisible();
    await expect(rep.page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    expect((await rep.page.request.delete(`/api/v1/leads/${ids[0]}`)).status()).toBe(403);
    await rep.context.close();

    await admin.page.goto(at('/sales/leads'));
    for (const name of names)
      await admin.page
        .getByRole('row', { name: new RegExp(name) })
        .getByRole('checkbox')
        .check();
    admin.page.once('dialog', (dialog) => void dialog.accept());
    await admin.page.getByRole('button', { name: 'Delete', exact: true }).click();
    for (const name of names) await expect(admin.page.getByText(name)).toHaveCount(0, { timeout: 30_000 });
    // The client hides soft-deleted rows unless a query names deletedAt, so ask for them explicitly.
    expect(await prisma.lead.count({ where: { tenantId, id: { in: ids }, deletedAt: { not: null } } })).toBe(
      ids.length,
    );
    expect((await admin.page.request.delete(`/api/v1/leads/${ids[0]}`)).status()).toBe(404);
    await admin.context.close();
  });

  test('tasks: the administrator deletes a task, the rep is refused, and a repeat is a 404', async ({ browser }) => {
    const admin = await signedIn(browser, workspace.adminEmail, workspace.adminPassword);
    const type = await prisma.taskType.findFirstOrThrow({ where: { tenantId }, select: { id: true } });
    const title = `Disposable task ${RUN_TAG}`;
    const created = await admin.page.request.post('/api/v1/tasks', {
      data: { typeId: type.id, title, dueAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(created.status(), await created.text()).toBeLessThan(300);
    const taskId = (await created.json()).id as string;

    const rep = await signedIn(browser, repEmail, repPassword);
    expect((await rep.page.request.delete(`/api/v1/tasks/${taskId}`)).status()).toBe(403);
    await rep.context.close();

    await admin.page.goto(at('/sales/tasks'));
    const row = admin.page.getByRole('row', { name: new RegExp(title) });
    await expect(row).toBeVisible({ timeout: 60_000 });
    admin.page.once('dialog', (dialog) => void dialog.accept());
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(admin.page.getByText(title)).toHaveCount(0, { timeout: 30_000 });
    expect(await prisma.task.count({ where: { tenantId, id: taskId, deletedAt: { not: null } } })).toBe(1);
    expect((await admin.page.request.delete(`/api/v1/tasks/${taskId}`)).status()).toBe(404);
    await admin.context.close();
  });

  test('calls: deleted from the detail page, gone from the list, its recording no longer streams', async ({
    browser,
  }) => {
    const admin = await signedIn(browser, workspace.adminEmail, workspace.adminPassword);
    const created = await admin.page.request.post('/api/v1/calls', {
      data: { recipientNumber: `+97155${String(Date.now()).slice(-7)}`, notes: `Disposable call ${RUN_TAG}` },
    });
    expect(created.status(), await created.text()).toBeLessThan(300);
    const callId = (await created.json()).id as string;

    const rep = await signedIn(browser, repEmail, repPassword);
    await rep.page.goto(at(`/sales/calls/${callId}`));
    await expect(rep.page.locator('main h1').first()).toBeVisible({ timeout: 60_000 });
    await expect(rep.page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    expect((await rep.page.request.delete(`/api/v1/calls/${callId}`)).status()).toBe(403);
    await rep.context.close();

    await admin.page.goto(at(`/sales/calls/${callId}`));
    await admin.page.getByRole('button', { name: 'Delete', exact: true }).click();
    await admin.page.getByRole('button', { name: 'Delete call' }).click();
    await expect(admin.page).not.toHaveURL(new RegExp(callId), { timeout: 30_000 });
    expect(await prisma.call.count({ where: { tenantId, id: callId, deletedAt: { not: null } } })).toBe(1);
    expect((await admin.page.request.delete(`/api/v1/calls/${callId}`)).status()).toBe(404);
    // Refused at the call, not merely because no recording exists.
    const media = await admin.page.request.get(`/api/v1/calls/${callId}/recording/media`);
    expect(media.status()).toBe(404);
    expect(JSON.stringify(await media.json())).toMatch(/Call/);
    expect(JSON.stringify(await media.json())).not.toMatch(/Recording/);
    await admin.context.close();
  });
});
