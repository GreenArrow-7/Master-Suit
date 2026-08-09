import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  createWorkspaceViaWizard,
  lastMailTo,
  linkFrom,
  login,
  loginPlatformOwner,
  logout,
  resetLoginThrottle,
  strongPassword,
  uniq,
} from './helpers';

/**
 * One happy path per HR module.
 *
 * `acceptance.spec.ts` covers hiring — an invitation sent, redeemed and the
 * employee appearing. It stops there, so leave, overtime, attendance, payroll
 * and recruitment had no browser coverage at all, and payroll in particular is a
 * six-step state machine that ends in somebody being paid.
 *
 * The workspace administrator is given an employee profile at provisioning, so
 * these run against that record rather than redeeming a second invitation for
 * every step.
 *
 * Serial and sharing one workspace: the payroll run at the end depends on the
 * compensation set in the middle.
 */
test.describe.configure({ mode: 'serial' });

test.describe('Each HR module opens and does its job', () => {
  const run = uniq();

  const workspace = {
    displayName: `People ${run}`,
    slug: `people-${run}`,
    adminName: 'People Administrator',
    adminEmail: `admin.people.${run}@masterapp.local`,
    adminPassword: strongPassword(`hr${run}`),
    modules: ['SALES', 'HRMS'] as ('SALES' | 'HRMS')[],
  };

  const at = (path: string) => `/${workspace.slug}/people${path}`;

  /**
   * Real dates, because the rules here are about time and they are good rules.
   *
   * Overtime cannot be claimed for a future date, and nothing can be recorded
   * before the employee joined. Somebody hired during this test joined today,
   * which leaves exactly one legal day for anything retrospective.
   */
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  const todayIso = iso(now);
  const monthStart = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const api = (path: string) => `/api/v1/workspaces/${workspace.slug}/hr/${path}`;

  const staff = {
    name: `Staff ${run}`,
    email: `staff.${run}@masterapp.local`,
    password: strongPassword(`st${run}`),
  };

  /**
   * A second administrator, because payroll refuses to let one person prepare
   * and approve the same run — the same four-eyes control the commission payout
   * run has, and worth keeping rather than testing around.
   */
  const approver = {
    name: `Approver ${run}`,
    email: `approver.${run}@masterapp.local`,
    password: strongPassword(`ap${run}`),
  };

  let employeeId = '';
  let runId = '';

  /**
   * The page loaded and stayed put.
   *
   * Used where the heading is composed by a shared component rather than
   * written in the page, so asserting a literal would be asserting the
   * component. A refusal redirects to /forbidden, which this still catches.
   */
  async function reaches(page: Page, path: string) {
    const response = await page.goto(at(path));
    expect(response?.status(), `${path} responded ${response?.status()}`).toBeLessThan(400);
    await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/people`));
  }

  /** The page loaded, and it is the page asked for rather than a redirect. */
  async function opens(page: Page, path: string, heading: string) {
    const response = await page.goto(at(path));
    expect(response?.status(), `${path} responded ${response?.status()}`).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
  }

  /** POST, asserting success with the server's own message when it fails. */
  async function post(request: APIRequestContext, path: string, data: Record<string, unknown>) {
    const response = await request.post(api(path), { data });
    expect(response.status(), `${path}: ${await response.text()}`).toBeLessThan(300);
    return response.json();
  }

  /** Redeem an invitation, leaving the browser signed in as nobody in particular. */
  async function redeem(page: Page, who: { name: string; email: string; password: string }) {
    const mail = await lastMailTo(page.request, who.email);
    await logout(page);
    await page.goto(linkFrom(mail.body, '/accept-invite'));
    await page.getByLabel('Your name').fill(who.name);
    await page.getByLabel('Password', { exact: true }).fill(who.password);
    await page.getByLabel('Confirm').fill(who.password);
    await page.getByRole('button', { name: 'Create my account' }).click();
    await expect(page.getByRole('heading', { name: 'You are in' })).toBeVisible({ timeout: 60_000 });
  }

  async function signIn(page: Page, email: string, password: string) {
    await logout(page);
    await resetLoginThrottle();
    await login(page, email, password);
  }

  const asAdmin = (page: Page) => signIn(page, workspace.adminEmail, workspace.adminPassword);

  test.beforeAll(resetLoginThrottle);

  test('a fresh workspace can run its people module end to end', async ({ page }) => {
    await test.step('a workspace is created with HR enabled and its administrator signs in', async () => {
      await loginPlatformOwner(page);
      await createWorkspaceViaWizard(page, workspace);
      await logout(page);
      await resetLoginThrottle();
      await login(page, workspace.adminEmail, workspace.adminPassword);
      await page.goto(`/${workspace.slug}/dashboard`);
      await expect(page).toHaveURL(new RegExp(`/${workspace.slug}/dashboard`));
    });

    await test.step('somebody is hired, and their record exists once they accept', async () => {
      await opens(page, '/employees', 'Employees');

      await page.goto(at('/employees/new'));
      await page.getByLabel('Full name').fill(staff.name);
      await page.getByLabel('Work email').fill(staff.email);
      await page.getByLabel('Employee number').fill(`E2E-${run}`.slice(0, 40));
      await page.getByRole('combobox', { name: 'Role' }).selectOption('employee');

      const [invited] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/hr/employees') && r.request().method() === 'POST'),
        page.getByRole('button', { name: 'Send invitation' }).click(),
      ]);
      expect(invited.status(), await invited.text()).toBeLessThan(300);

      // The approver needs a role of their own. An administrator cannot mint a
      // second administrator — "You cannot modify your own role" — which is a
      // privilege-escalation guard worth keeping, so instead they create a role
      // beneath their own rank and grant it the one authority it needs.
      const roles = `/api/v1/workspaces/${workspace.slug}/roles`;
      const created = await page.request.post(`${roles}/create`, {
        data: { key: `payroll-approver-${run}`.slice(0, 50), name: 'Payroll Approver', rank: 20 },
      });
      expect(created.status(), await created.text()).toBeLessThan(300);
      // The server normalises the key — hyphens become underscores — so the
      // invitation below uses what it actually stored. Reconstructing it here
      // silently missed, and the invite quietly created a fresh default role
      // with none of the permissions granted a moment later.
      const createdRole = await created.json();
      const roleId = createdRole.id;
      const roleKey = createdRole.key;

      const matrix = await (await page.request.get(`${roles}/matrix?roleId=${roleId}`)).json();
      // Payroll to approve it, employee:VIEW because the HR routes gate on
      // being able to see the people a run is about.
      const needed = (matrix.permissions as { permissionId: string; module: string; action: string }[]).filter(
        (perm) =>
          (perm.module === 'payroll' && ['APPROVE', 'VIEW'].includes(perm.action)) ||
          (perm.module === 'employee' && perm.action === 'VIEW') ||
          (perm.module === 'hrms' && perm.action === 'VIEW'),
      );
      expect(needed.length, 'payroll:APPROVE should be grantable').toBeGreaterThan(0);

      const granted = await page.request.post(`${roles}/matrix-update`, {
        data: {
          roleId,
          changes: needed.map((perm) => ({ permissionId: perm.permissionId, granted: true, scope: 'ORGANIZATION' })),
        },
      });
      expect(granted.status(), await granted.text()).toBeLessThan(300);

      // Read back, because a grant that did not land produces a 403 much later
      // and a long hunt for the reason.
      const after = await (await page.request.get(`${roles}/matrix?roleId=${roleId}`)).json();
      const approve = (after.permissions as { module: string; action: string; granted: boolean; scope: string }[]).find(
        (perm) => perm.module === 'payroll' && perm.action === 'APPROVE',
      );
      expect(approve, 'payroll:APPROVE should be on the matrix').toBeTruthy();
      expect(approve!.granted, JSON.stringify(approve)).toBe(true);
      expect(approve!.scope, JSON.stringify(approve)).toBe('ORGANIZATION');

      // Both invitations are sent while still signed in as the administrator;
      // redeeming one signs the browser out.
      const invitedApprover = await page.request.post(api('employees'), {
        data: {
          fullName: approver.name,
          email: approver.email,
          employeeNumber: `APR-${run}`.slice(0, 40),
          roleKey,
        },
      });
      expect(invitedApprover.status(), await invitedApprover.text()).toBeLessThan(300);

      // The employee record is created on acceptance, not on invitation, so the
      // links have to be redeemed before anything below has somebody to act on.
      await redeem(page, staff);
      await redeem(page, approver);

      await asAdmin(page);

      const employees = await (await page.request.get(api('employees'))).json();
      const list = Array.isArray(employees) ? employees : (employees.data ?? []);
      const hired = list.find((e: { fullName?: string; employeeNumber?: string }) =>
        (e.employeeNumber ?? '').includes(run),
      );
      expect(hired, 'the accepted invitation should have produced an employee').toBeTruthy();
      employeeId = hired.id;
    });

    await test.step('a department is created and appears', async () => {
      await opens(page, '/departments', 'Departments');
      await post(page.request, 'departments', { name: `Operations ${run}`, code: `OPS${run}`.slice(0, 12) });
      await page.reload();
      await expect(page.getByText(`Operations ${run}`)).toBeVisible();
    });

    await test.step('leave is applied for and approved', async () => {
      await opens(page, '/leave', 'Leave');

      // HRMS seeds ANNUAL and SICK at provisioning, so a fresh workspace can
      // take a request without anyone configuring one first.
      const types = await (await page.request.get(api('leave-types'))).json();
      expect(types.length, 'HRMS should seed leave types').toBeGreaterThan(0);
      const annual = types.find((t: { code: string }) => t.code === 'ANNUAL') ?? types[0];

      // On the employee's behalf, which is both a real HR flow and the only one
      // that resolves an approver: `approverFor` deliberately excludes the
      // applicant, so the sole employee of a workspace cannot route their own.
      const applied = await post(page.request, 'actions/leave-apply', {
        employeeId,
        leaveTypeId: annual.id,
        startDate: '2027-03-01',
        endDate: '2027-03-03',
        reason: `Happy path ${run}`,
      });
      expect(applied.status).toBe('PENDING');

      // Checked while it is still pending: the approval queue on this page
      // shows PENDING only, so approving first would make it vanish before it
      // was ever seen.
      await page.reload();
      await expect(page.getByText(`Happy path ${run}`).first()).toBeVisible();

      const decided = await post(page.request, 'actions/leave-approve', {
        requestId: applied.id,
        note: 'Approved by the happy path',
      });
      expect(decided.status).toBe('APPROVED');

      // And it leaves the queue once decided, which is the queue doing its job.
      await page.reload();
      await expect(page.getByText(`Happy path ${run}`)).toHaveCount(0);
    });

    await test.step('overtime is requested and decided', async () => {
      await opens(page, '/overtime', 'Overtime');

      const requested = await post(page.request, 'actions/overtime-request', {
        employeeId,
        workDate: todayIso,
        minutes: 90,
        reason: `Late handover ${run}`,
      });

      // Seen while pending, for the same reason as leave: this page is an
      // approval queue, and a decided request has left it by definition.
      await page.reload();
      await expect(page.getByText(`Late handover ${run}`).first()).toBeVisible();

      const decided = await post(page.request, 'actions/overtime-decide', {
        requestId: requested.id,
        approve: true,
        note: 'Approved by the happy path',
      });
      expect(decided.status).toBe('APPROVED');

      await page.reload();
      await expect(page.getByText(`Late handover ${run}`)).toHaveCount(0);
    });

    await test.step('attendance is recorded and shows on the register', async () => {
      await opens(page, '/attendance', 'Attendance');
      await post(page.request, 'attendance', {
        employeeId,
        workDate: todayIso,
        status: 'PRESENT',
        notes: `On site ${run}`,
      });
      // The register defaults to today, so the assertion is on the API rather
      // than on a date the page is not showing.
      const records = await (await page.request.get(api(`attendance?from=${todayIso}&to=${todayIso}`))).json();
      const rows = Array.isArray(records) ? records : (records.data ?? []);
      expect(rows.length).toBeGreaterThan(0);
    });

    await test.step('payroll runs the whole way to paid', async () => {
      await opens(page, '/payroll', 'Payroll');

      // Nothing can be calculated for somebody with no salary on file.
      await post(page.request, 'actions/compensation-set', {
        employeeId,
        effectiveFrom: monthStart,
        basic: 20000,
        housing: 8000,
        transport: 2000,
        changeReason: `Happy path ${run}`,
      });

      const created = await post(page.request, 'actions/payroll-run-create', {
        periodStart: monthStart,
        // End of day, not midnight. `joinedOn` is a timestamp, so a bare date
        // excludes anyone hired that morning — which is everybody here.
        periodEnd: `${todayIso}T23:59:59.000Z`,
        note: `Happy path ${run}`,
      });
      runId = created.id;

      // Six steps, in order. Each is a separate authority in a real payroll
      // department, and the state machine refuses to skip one.
      await post(page.request, 'actions/payroll-run-calculate', { runId });
      await post(page.request, 'actions/payroll-run-submit', { runId });
      // Somebody else, by design.
      await signIn(page, approver.email, approver.password);
      await post(page.request, 'actions/payroll-run-decide', { runId, approve: true, note: 'Approved' });

      await asAdmin(page);
      await post(page.request, 'actions/payroll-run-lock', { runId });
      const paid = await post(page.request, 'actions/payroll-run-paid', { runId });
      expect(paid.status).toBe('PAID');

      // A run that reaches PAID with no payslip behind it has paid nobody.
      // Payslips are read per employee — the endpoint is self-service, and an
      // administrator reaches somebody else's through payroll:VIEW.
      const payslips = await (await page.request.get(api(`payslips?employeeId=${employeeId}`))).json();
      const slips = Array.isArray(payslips) ? payslips : (payslips.data ?? []);
      expect(slips.length, 'a paid run should have produced a payslip').toBeGreaterThan(0);
      expect(Number(slips[0].netPay), JSON.stringify(slips[0])).toBeGreaterThan(0);

      await reaches(page, '/payslips');
    });

    await test.step('the remaining people pages open', async () => {
      // Recruitment and performance are read-only over the API — there is no
      // candidate create endpoint — so the honest check is that they render.
      await reaches(page, '/recruitment');
      await reaches(page, '/performance');
      await reaches(page, '/holidays');
      await reaches(page, '/documents');
    });
  });
});
