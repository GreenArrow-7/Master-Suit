import { test, expect, type APIRequestContext } from '@playwright/test';
import { prisma } from '@/lib/db';
import { createWorkspaceUser, grantPermissions } from '../helpers/fixtures';
import { login, ok, resetLoginThrottle, strongPassword, uniq } from './helpers';

/**
 * Deactivating a member hands their open work on (M2-02).
 *
 * Deactivate and Remove used to leave an agent's open leads, follow-ups and
 * tasks owned by a SUSPENDED account: invisible to colleagues at OWN scope and
 * absent from the Allocation queue. Admin > Users now asks where the work goes
 * before it acts — a member, or the allocation queue for the leads — and the
 * server refuses the deactivation without that answer.
 */
const slug = process.env.E2E_DEMO_SLUG!;
const email = process.env.E2E_DEMO_EMAIL!;
const password = process.env.E2E_DEMO_PASSWORD!;
const base = () => process.env.APP_URL ?? 'http://localhost:3000';
const run = uniq();
const at = (path: string) => `/${slug}${path}`;

const OPEN = { in: ['OPEN', 'IN_PROGRESS', 'RESCHEDULED'] as ('OPEN' | 'IN_PROGRESS' | 'RESCHEDULED')[] };

test.describe('Admin > Users: Deactivate asks where the open work goes', () => {
  test.skip(!slug || !email || !password, 'E2E_DEMO_SLUG / E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD not set');
  test.beforeEach(resetLoginThrottle);
  test.setTimeout(5 * 60_000);

  let tenantId = '';
  let roleId = '';
  let typeId = '';
  let phoneSeed = Date.now();

  /** A member made through the same endpoint the Add user screen uses. */
  async function account(admin: APIRequestContext, name: string, code: string) {
    const created = await ok(
      await admin.post(`/api/v1/workspaces/${slug}/identity/account-create`, {
        data: {
          fullName: name,
          employeeNumber: `HO-${code}-${run}`,
          email: `${name.replace(/\W+/g, '-').toLowerCase()}@example.com`,
          roleId,
          joinedOn: new Date().toISOString().slice(0, 10),
          attendanceEligible: false,
        },
      }),
      `create ${name}`,
    );
    return created.userId as string;
  }

  /** `leads` open leads owned by the agent, through the API; follow-ups and tasks on them. */
  async function work(admin: APIRequestContext, ownerId: string, leads: number, followUps: number, tasks: number) {
    const leadIds: string[] = [];
    for (let i = 0; i < leads; i += 1) {
      phoneSeed += 1;
      const lead = await ok(
        await admin.post('/api/v1/leads', {
          data: {
            fullName: `Hand-over ${run} ${ownerId.slice(-4)} ${i}`,
            phone: `+9715${String(phoneSeed).slice(-8)}`,
            ownerId,
          },
        }),
        'lead',
      );
      leadIds.push(lead.id);
    }
    const dueAt = new Date(Date.now() + 86_400_000);
    for (let i = 0; i < followUps; i += 1) {
      await prisma.followUpTask.create({
        data: { tenantId, ownerId, leadId: leadIds[i] ?? null, title: `Call back ${run} ${i}`, dueAt },
      });
    }
    for (let i = 0; i < tasks; i += 1) {
      await prisma.task.create({
        data: { tenantId, typeId, ownerId, leadId: leadIds[i] ?? null, title: `Brochure ${run}`, dueAt },
      });
    }
    return leadIds;
  }

  const openOwnedBy = async (ownerId: string) => ({
    leads: await prisma.lead.count({
      where: { tenantId, ownerId, deletedAt: null, stage: { is: { category: 'OPEN' } } },
    }),
    followUps: await prisma.followUpTask.count({ where: { tenantId, ownerId, deletedAt: null, status: OPEN } }),
    tasks: await prisma.task.count({ where: { tenantId, ownerId, deletedAt: null, status: OPEN } }),
  });

  test('hand 3 open leads, 2 follow-ups and 1 task to a member; or send the leads to the queue', async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: base() });
    const page = await context.newPage();
    await login(page, email, password);
    const admin = page.request;

    tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug }, select: { id: true } })).id;
    roleId = (
      await ok(
        await admin.post(`/api/v1/workspaces/${slug}/roles/create`, {
          data: { key: `handover_${run}`, name: `Hand-over agent ${run}`, rank: 60 },
        }),
        'create role',
      )
    ).id;
    typeId =
      (await prisma.taskType.findFirst({ where: { tenantId, isActive: true }, select: { id: true } }))?.id ??
      (await prisma.taskType.create({ data: { tenantId, key: `handover-${run}`, name: 'Hand-over' } })).id;

    const agentName = `Leaving Agent ${run}`;
    const receiverName = `Receiving Agent ${run}`;
    const agentId = await account(admin, agentName, 'L');
    const receiverId = await account(admin, receiverName, 'R');
    await work(admin, agentId, 3, 2, 1);

    await test.step('the step names the work, and Deactivate waits for a member', async () => {
      await page.goto(at(`/admin/users?q=${encodeURIComponent(agentName)}`));
      const row = page.getByRole('row', { name: new RegExp(agentName) });
      await row.getByRole('button', { name: 'Deactivate', exact: true }).click();
      await expect(page.getByText('Hand 3 open leads, 2 follow-ups and 1 task to')).toBeVisible({ timeout: 60_000 });
      const submit = page.getByRole('button', { name: 'Deactivate account' });
      await expect(submit).toBeDisabled();
      await page.getByLabel('Member').selectOption({ label: receiverName });
      await expect(submit).toBeEnabled();
      await submit.click();
      // Active only is the directory's default view, so the row leaves it.
      await expect(page.getByRole('row', { name: new RegExp(agentName) })).toHaveCount(0, { timeout: 60_000 });
    });

    expect(
      (await prisma.user.findFirstOrThrow({ where: { tenantId, id: agentId }, select: { status: true } })).status,
    ).toBe('SUSPENDED');
    expect(await openOwnedBy(agentId)).toEqual({ leads: 0, followUps: 0, tasks: 0 });
    expect(await openOwnedBy(receiverId)).toEqual({ leads: 3, followUps: 2, tasks: 1 });

    await test.step('leads sent to the queue wait in Allocation, unassigned', async () => {
      const queuedName = `Queued Agent ${run}`;
      const queuedId = await account(admin, queuedName, 'Q');
      const [leadId] = await work(admin, queuedId, 1, 0, 0);

      await page.goto(at(`/admin/users?q=${encodeURIComponent(queuedName)}`));
      await page
        .getByRole('row', { name: new RegExp(queuedName) })
        .getByRole('button', { name: 'Deactivate', exact: true })
        .click();
      await expect(page.getByText('Hand 1 open lead to')).toBeVisible({ timeout: 60_000 });
      await page.getByLabel('or send the leads to the allocation queue').check();
      // Only a lead is left, so the queue needs no member.
      await expect(page.getByLabel('Member')).toHaveCount(0);
      await page.getByRole('button', { name: 'Deactivate account' }).click();
      await expect(page.getByRole('row', { name: new RegExp(queuedName) })).toHaveCount(0, { timeout: 60_000 });

      const lead = await prisma.lead.findFirstOrThrow({
        where: { tenantId, id: leadId },
        select: { ownerId: true, fullName: true },
      });
      expect(lead.ownerId).toBeNull();
      const entry = { tenantId, leadId, status: 'WAITING' as const };
      // The Waiting view lists the 100 oldest. Made the oldest, so entries other
      // specs left in the shared workspace cannot push it off the page.
      await prisma.leadTriageEntry.updateMany({ where: entry, data: { openedAt: new Date('2000-01-01T00:00:00Z') } });
      try {
        await page.goto(at('/sales/allocation?view=waiting'));
        await expect(page.getByRole('link', { name: lead.fullName })).toBeVisible({ timeout: 60_000 });
        await expect(page.getByText(`Handed back when ${queuedName} was deactivated`)).toBeVisible();
      } finally {
        // Closed, so each run does not leave one more waiting entry behind.
        await prisma.leadTriageEntry.updateMany({
          where: entry,
          data: { status: 'CANCELLED', resolvedAt: new Date(), resolution: 'E2E clean-up' },
        });
      }
    });

    await test.step('an account administrator who cannot assign the work is told before submit', async () => {
      const taskOnlyName = `Task Only Agent ${run}`;
      const taskOnlyId = await account(admin, taskOnlyName, 'T');
      await work(admin, taskOnlyId, 0, 0, 1);

      // users:MANAGE_USERS and nothing of Sales, like the seeded it_admin.
      const role = await prisma.role.create({
        data: {
          tenantId,
          key: `handover_it_${run}`,
          name: `Accounts only ${run}`,
          rank: 30,
          defaultScope: 'ORGANIZATION',
        },
      });
      await grantPermissions(tenantId, role.id, [
        ['users', 'VIEW'],
        ['users', 'MANAGE_USERS'],
      ]);
      const itEmail = `handover-it-${run}@example.com`;
      const itPassword = strongPassword(run);
      const it = await createWorkspaceUser({
        tenantId,
        roleId: role.id,
        email: itEmail,
        fullName: `Accounts Admin ${run}`,
        password: itPassword,
      });
      await prisma.platformUser.update({
        where: { id: it.platformUserId },
        data: { passwordChangedAt: new Date(), emailVerifiedAt: new Date() },
      });

      const itContext = await browser.newContext({ baseURL: base() });
      try {
        const itPage = await itContext.newPage();
        await login(itPage, itEmail, itPassword);
        await itPage.goto(at(`/admin/users?q=${encodeURIComponent(taskOnlyName)}`));
        await itPage
          .getByRole('row', { name: new RegExp(taskOnlyName) })
          .getByRole('button', { name: 'Deactivate', exact: true })
          .click();
        await expect(itPage.getByText('They own 1 task, and your role cannot assign their work.')).toBeVisible({
          timeout: 60_000,
        });
        await expect(itPage.getByRole('button', { name: 'Deactivate account' })).toBeDisabled();
      } finally {
        await itContext.close();
      }
    });

    await context.close();
  });
});
