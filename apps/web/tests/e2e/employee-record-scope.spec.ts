/**
 * Employee records, as the people who read them — through the sign-in form and
 * the served pages, with a populated workspace.
 *
 * An OWN-scope employee sees their own row, journey, document and checklist and
 * nobody else's. HR still sees everyone and whose documents expire, but not
 * identity-document numbers without that permission. A line manager (TEAM scope,
 * leave approver) keeps the workflows that make them a manager: the leave request
 * routed to them, and a report's checklist. A role with no employee permission
 * reaches none of it.
 */
import { randomBytes } from 'node:crypto';
import { test, expect, type Browser, type Page } from '@playwright/test';
import type { PermissionAction, VisibilityScope } from '@prisma/client';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { login, resetLoginThrottle, strongPassword, uniq } from './helpers';

const run = uniq();
const slug = `empscope-${run}`.toLowerCase();
const password = strongPassword(`es${run}`);
const DAY = 86_400_000;

let tenantId = '';
const people: Record<string, { email: string; name: string; number: string; employeeId: string }> = {};
const documentNumbers: Record<string, string> = {};

async function person(label: string, grants: [string, PermissionAction, VisibilityScope][], status?: string) {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${run}`, name: label, rank: 40, defaultScope: 'OWN' },
  });
  for (const [module, action, scope] of grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope },
    });
  }
  const email = `${label}-${run}@empscope.test`;
  const name = `Scope ${label} ${run}`;
  const platformUser = await prisma.platformUser.create({
    data: {
      email,
      normalizedEmail: email,
      fullName: name,
      status: 'ACTIVE',
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      emailVerifiedAt: new Date(),
    },
  });
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: name, roleId: role.id, status: 'ACTIVE' },
  });
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  if (status) {
    const number = `ES-${label}-${run}`;
    const profile = await prisma.employeeProfile.create({
      data: { tenantId, membershipId: membership.id, employeeNumber: number, employmentStatus: status },
    });
    people[label] = { email, name, number, employeeId: profile.id };
  } else {
    people[label] = { email, name, number: '', employeeId: '' };
  }
}

async function signedIn(browser: Browser, label: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await resetLoginThrottle();
  await login(page, people[label].email, password);
  return { page, close: () => context.close() };
}

const hr = (page: Page, resource: string, query = '') =>
  page.evaluate(
    async ({ url }) => {
      const res = await fetch(url);
      return { status: res.status, body: res.ok ? await res.json() : null };
    },
    { url: `/api/v1/workspaces/${slug}/hr/${resource}${query}` },
  );

test.describe('Employee record scope', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { slug, legalName: `EmpScope ${run} LLC`, displayName: `EmpScope ${run}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

    const O = 'ORGANIZATION' as const;
    await person(
      'hradmin',
      [
        ['employee', 'VIEW', O],
        ['employee', 'EDIT', O],
        ['leave', 'VIEW', O],
      ],
      'ACTIVE',
    );
    await person('plain', [['employee', 'VIEW', 'OWN']], 'ONBOARDING');
    await person(
      'manager',
      [
        ['employee', 'VIEW', 'TEAM'],
        ['leave', 'VIEW', 'TEAM'],
        ['leave', 'APPROVE', 'TEAM'],
      ],
      'ACTIVE',
    );
    await person('nogrants', [['leads', 'VIEW', 'OWN']]);
    await person('joiner', [], 'ONBOARDING');

    for (const [label, days] of [
      ['plain', 20],
      ['joiner', 30],
    ] as const) {
      documentNumbers[label] = `P${randomBytes(4).toString('hex').toUpperCase()}`;
      await prisma.hrEmployeeDocument.create({
        data: {
          tenantId,
          employeeId: people[label].employeeId,
          kind: 'PASSPORT',
          name: `Passport ${label}`,
          number: documentNumbers[label],
          expiresAt: new Date(Date.now() + days * DAY),
        },
      });
    }
    for (const [label, title] of [
      ['plain', `Own offer letter ${run}`],
      ['joiner', `Joiner visa step ${run}`],
    ] as const) {
      await prisma.hrChecklistTask.create({
        data: {
          tenantId,
          employeeId: people[label].employeeId,
          phase: 'ONBOARDING',
          title,
          blocking: true,
          dueDate: new Date(Date.now() - 2 * DAY),
        },
      });
    }
    const leaveType = await prisma.hrLeaveType.create({ data: { tenantId, name: 'Annual', code: `AN-${run}` } });
    await prisma.hrLeaveRequest.create({
      data: {
        tenantId,
        employeeId: people.joiner.employeeId,
        leaveTypeId: leaveType.id,
        approverId: people.manager.employeeId,
        startDate: new Date(Date.now() + 10 * DAY),
        endDate: new Date(Date.now() + 11 * DAY),
        days: 2,
        reason: `Report leave ${run}`,
      },
    });
  });

  test.afterAll(async () => {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.platformUser
      .deleteMany({ where: { normalizedEmail: { endsWith: `-${run}@empscope.test`.toLowerCase() } } })
      .catch(() => {});
  });

  test('an OWN-scope employee sees only their own record, journey, document and checklist', async ({ browser }) => {
    const { page, close } = await signedIn(browser, 'plain');
    try {
      await page.goto(`/${slug}/people/employees`);
      await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible();
      await expect(page.getByText(people.plain.email)).toBeVisible();
      for (const other of ['hradmin', 'manager', 'joiner'])
        await expect(page.getByText(people[other].email)).toHaveCount(0);

      await page.goto(`/${slug}/people/lifecycle`);
      await expect(page.getByText(people.plain.name).first()).toBeVisible();
      await expect(page.getByText(people.joiner.name)).toHaveCount(0);

      await page.goto(`/${slug}/people/lifecycle?employee=${people.joiner.employeeId}`);
      await expect(page.getByText(`Joiner visa step ${run}`)).toHaveCount(0);
      await page.goto(`/${slug}/people/lifecycle?employee=${people.plain.employeeId}`);
      await expect(page.getByText(`Own offer letter ${run}`)).toBeVisible();

      const employees = await hr(page, 'employees');
      expect(employees.body.map((row: { employeeNumber: string }) => row.employeeNumber)).toEqual([
        people.plain.number,
      ]);
      const documents = await hr(page, 'expiring-documents');
      expect(documents.body).toHaveLength(1);
      expect(documents.body[0].number).toBe(documentNumbers.plain);
      expect((await hr(page, 'expiring-documents', `?employeeId=${people.joiner.employeeId}`)).body).toEqual([]);
      expect(JSON.stringify(await hr(page, 'lifecycle'))).not.toContain(people.joiner.name);
    } finally {
      await close();
    }
  });

  test('HR sees everyone and whose documents expire, but not identity-document numbers', async ({ browser }) => {
    const { page, close } = await signedIn(browser, 'hradmin');
    try {
      await page.goto(`/${slug}/people/employees`);
      for (const label of ['hradmin', 'plain', 'manager', 'joiner'])
        await expect(page.getByText(people[label].email)).toBeVisible();

      await page.goto(`/${slug}/people/lifecycle?employee=${people.joiner.employeeId}`);
      await expect(page.getByText(people.joiner.name).first()).toBeVisible();
      await expect(page.getByText(`Joiner visa step ${run}`)).toBeVisible();

      const documents = await hr(page, 'expiring-documents');
      expect(documents.body.map((row: { employeeId: string }) => row.employeeId).sort()).toEqual(
        [people.plain.employeeId, people.joiner.employeeId].sort(),
      );
      expect(documents.body.every((row: { number: string | null }) => row.number === null)).toBe(true);
      expect(JSON.stringify(documents.body)).not.toContain(documentNumbers.joiner);
    } finally {
      await close();
    }
  });

  test('a TEAM-scope manager keeps the leave request routed to them and a report’s checklist', async ({ browser }) => {
    const { page, close } = await signedIn(browser, 'manager');
    try {
      const leave = await hr(page, 'leave');
      expect(leave.status).toBe(200);
      expect(JSON.stringify(leave.body)).toContain(`Report leave ${run}`);

      await page.goto(`/${slug}/people/lifecycle?employee=${people.joiner.employeeId}`);
      await expect(page.getByText(`Joiner visa step ${run}`)).toBeVisible();

      // The directory and document lists stay at their own record: TEAM scope is
      // not the whole workspace, and the lists have no team filter to apply.
      await page.goto(`/${slug}/people/employees`);
      await expect(page.getByText(people.manager.email)).toBeVisible();
      await expect(page.getByText(people.joiner.email)).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test('a role with no employee permission reaches no employee data', async ({ browser }) => {
    const { page, close } = await signedIn(browser, 'nogrants');
    try {
      for (const path of ['/people/employees', '/people/lifecycle']) {
        await page.goto(`/${slug}${path}`);
        await expect(page.getByText('You do not have access to this page')).toBeVisible();
        for (const label of ['hradmin', 'plain', 'joiner'])
          await expect(page.getByText(people[label].email)).toHaveCount(0);
      }
      for (const resource of ['employees', 'lifecycle', 'expiring-documents']) {
        expect((await hr(page, resource)).status, resource).toBe(403);
      }
    } finally {
      await close();
    }
  });
});
