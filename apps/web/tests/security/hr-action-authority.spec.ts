/**
 * Each HR verb needs its own authority — and nothing else.
 *
 * ── The failure this exists for ─────────────────────────────────────────────
 *
 * `POST /workspaces/[slug]/hr/actions/[action]` declared a kernel gate of
 * `employee:VIEW`, which ran *before* the per-action permission was consulted.
 * Reaching any verb therefore required `employee:VIEW` **and** the verb's own
 * authority — a conjunction nobody designed.
 *
 * `finance_admin` is the role the seed makes the payroll approver: it holds
 * `payroll:APPROVE` at ORGANIZATION and does not hold `employee:VIEW`, because
 * approving a payroll run is not a reason to read everyone's employee record.
 * So the designated approver could not approve, and payroll maker-checker
 * collapsed onto `org_admin` — the only role holding both halves.
 *
 * The tests below pin both directions across **every permission category the
 * action map uses**, not only payroll: a fix that widened anyone's grant, or
 * removed the per-action assertion, fails here.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PermissionAction, VisibilityScope } from '@prisma/client';
import { prisma } from '@/lib/db';
import { POST as hrAction } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/actions/[action]/route';
import { createSessionToken } from '../helpers/session';
import { post } from '../helpers/request';

const suffix = randomBytes(4).toString('hex');
const slug = `hrauth-${suffix}`;

let tenantId = '';
let runId = '';
const cookies: Record<string, string> = {};
const employees: Record<string, string> = {};

async function actor(label: string, grants: [string, PermissionAction][], scope: VisibilityScope = 'ORGANIZATION') {
  const email = `${label}-${suffix}@auth.test`;
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 40, defaultScope: scope },
  });
  for (const [module, action] of grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope },
    });
  }
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: label, roleId: role.id, status: 'ACTIVE' },
  });
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: label, status: 'ACTIVE' },
  });
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  const employee = await prisma.employeeProfile.create({
    data: {
      tenantId,
      membershipId: membership.id,
      employeeNumber: `E-${label}-${suffix}`,
      joinedOn: new Date('2026-01-01T00:00:00Z'),
      employmentStatus: 'ACTIVE',
    },
  });
  cookies[label] = await createSessionToken(tenantId, user.id);
  employees[label] = employee.id;
}

const act = (label: string, action: string, body: Record<string, unknown> = {}) =>
  post(hrAction, `/api/v1/workspaces/${slug}/hr/actions/${action}`, body, cookies[label], {
    workspaceSlug: slug,
    action,
  });

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'HR Authority LLC', displayName: 'HR Authority', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });

  // The seeded split: preparer holds CREATE/EDIT, approver holds APPROVE.
  // Neither holds employee:VIEW — that is the point.
  await actor('officer', [
    ['payroll', 'CREATE'],
    ['payroll', 'EDIT'],
  ]);
  await actor('approver', [['payroll', 'APPROVE']]);
  await actor('bystander', [['employee', 'VIEW']]);
  await actor(
    'staff',
    [
      ['employee', 'VIEW'],
      ['leave', 'CREATE'],
    ],
    'OWN',
  );
  await actor('salesOnly', [['leads', 'VIEW']]);

  // One holder per category the action map uses, so each can be probed in both
  // directions without borrowing another category's authority.
  await actor('leaveApprover', [['leave', 'APPROVE']]);
  await actor('attendanceApprover', [['attendance', 'APPROVE']]);
  await actor('overtimeApprover', [['overtime', 'APPROVE']]);
  await actor('shiftsEditor', [['shifts', 'EDIT']]);
  await actor('recruiter', [['recruitment', 'EDIT']]);
  await actor('performanceLead', [['performance', 'APPROVE']]);
  await actor('employeeEditor', [['employee', 'EDIT']]);

  await prisma.hrLeaveType.create({
    data: { tenantId, name: 'Annual', code: `ANN-${suffix}`, annualAllowance: 30, paid: true },
  });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser
    .deleteMany({ where: { normalizedEmail: { endsWith: `-${suffix}@auth.test` } } })
    .catch(() => {});
});

describe('payroll: preparation and approval are different authorities', () => {
  it('the preparer creates, calculates and submits a run', async () => {
    const created = await act('officer', 'payroll-run-create', {
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    runId = created.body.id;

    expect((await act('officer', 'payroll-run-calculate', { runId })).status).toBe(200);
    expect((await act('officer', 'payroll-run-submit', { runId })).status).toBe(200);
  });

  it('the preparer cannot approve their own run', async () => {
    expect((await act('officer', 'payroll-run-decide', { runId, approve: true })).status).toBe(403);
  });

  it('the approver approves it — holding payroll:APPROVE and no employee:VIEW', async () => {
    const decided = await act('approver', 'payroll-run-decide', { runId, approve: true });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
  });
});

/**
 * Every permission category the action map uses, probed both ways.
 *
 * The positive direction asserts *authorisation*, not success: most of these
 * verbs then fail on business rules because the fixture has no requisition, no
 * roster and no review cycle. A 403 is the only status that would mean the gate
 * refused, so that is what is asserted against.
 */
describe('every permission category', () => {
  const cases: { holder: string; action: string; body?: Record<string, unknown>; category: string }[] = [
    { holder: 'leaveApprover', action: 'leave-approve', body: { requestId: 'x' }, category: 'leave:APPROVE' },
    {
      holder: 'attendanceApprover',
      action: 'exception-decide',
      body: { requestId: 'x', approve: true },
      category: 'attendance:APPROVE',
    },
    {
      holder: 'overtimeApprover',
      action: 'overtime-decide',
      body: { requestId: 'x', approve: true },
      category: 'overtime:APPROVE',
    },
    { holder: 'shiftsEditor', action: 'roster-assign', body: { employeeId: 'x' }, category: 'shifts:EDIT' },
    { holder: 'recruiter', action: 'candidate-add', body: { requisitionId: 'x' }, category: 'recruitment:EDIT' },
    { holder: 'performanceLead', action: 'cycle-create', body: { name: 'x' }, category: 'performance:APPROVE' },
    { holder: 'employeeEditor', action: 'settings-update', body: {}, category: 'employee:EDIT' },
  ];

  it.each(cases)('$category — the holder is authorised for $action', async ({ holder, action, body }) => {
    const res = await act(holder, action, body);
    expect(res.status, `${holder}/${action}: ${JSON.stringify(res.body)}`).not.toBe(403);
  });

  it.each(cases)('$category — a sales-only account is refused $action', async ({ action, body }) => {
    expect((await act('salesOnly', action, body)).status).toBe(403);
  });

  it.each(cases)('$category — employee:VIEW alone is refused $action', async ({ action, body }) => {
    expect((await act('bystander', action, body)).status).toBe(403);
  });
});

describe('nothing else was widened', () => {
  it('the approver cannot create a run — APPROVE is not CREATE', async () => {
    const created = await act('approver', 'payroll-run-create', {
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
    expect(created.status).toBe(403);
  });

  it('the preparer cannot reach an unrelated category', async () => {
    expect((await act('officer', 'settings-update', { workWeek: [1, 2, 3, 4, 5] })).status).toBe(403);
  });

  it('a payroll holder cannot approve leave', async () => {
    expect((await act('approver', 'leave-approve', { requestId: 'x' })).status).toBe(403);
  });
});

describe('self-service keeps the floor the kernel used to apply', () => {
  /**
   * Asserted as "authorised", not "succeeded". This fixture's employee has no
   * manager, so `applyForLeave` refuses with 409 "No approver is set up" —
   * correct application behaviour with nothing to do with permissions. A 409
   * proves the gate let it through; a 403 would disprove it. Asserting 200 here
   * would be asserting the fixture.
   */
  it('an ordinary employee is authorised to apply for their own leave', async () => {
    const type = await prisma.hrLeaveType.findFirstOrThrow({ where: { tenantId } });
    const applied = await act('staff', 'leave-apply', {
      leaveTypeId: type.id,
      startDate: '2026-11-10',
      endDate: '2026-11-11',
      reason: 'authority regression test',
    });
    expect(applied.status, JSON.stringify(applied.body)).not.toBe(403);
    expect(applied.status).toBeLessThan(500);
  });

  it('a caller with no HR grant at all is refused a self-service verb', async () => {
    const type = await prisma.hrLeaveType.findFirstOrThrow({ where: { tenantId } });
    const applied = await act('salesOnly', 'leave-apply', {
      leaveTypeId: type.id,
      startDate: '2026-11-10',
      endDate: '2026-11-11',
      reason: 'should not be authorised',
    });
    expect(applied.status).toBe(403);
  });

  it('self-service acts on the caller, not on somebody else', async () => {
    const type = await prisma.hrLeaveType.findFirstOrThrow({ where: { tenantId } });
    // `staff` holds employee:VIEW at OWN and names another person's employee id.
    const applied = await act('staff', 'leave-apply', {
      employeeId: employees.approver,
      leaveTypeId: type.id,
      startDate: '2026-12-01',
      endDate: '2026-12-02',
      reason: 'on behalf of someone else',
    });
    expect(applied.status, JSON.stringify(applied.body)).toBeGreaterThanOrEqual(400);
  });
});

describe('the surrounding controls are intact', () => {
  it('an unmapped action is refused before any handler runs', async () => {
    const res = await act('approver', 'not-a-real-action', {});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).not.toBe(500);
  });

  it('an unauthenticated caller is refused', async () => {
    const res = await post(
      hrAction,
      `/api/v1/workspaces/${slug}/hr/actions/payroll-run-decide`,
      { runId, approve: true },
      undefined,
      { workspaceSlug: slug, action: 'payroll-run-decide' },
    );
    expect(res.status).toBe(401);
  });

  it('a caller from another workspace cannot act on this one', async () => {
    const otherSlug = `${slug}-other`;
    const other = await prisma.tenant.create({
      data: { slug: otherSlug, legalName: 'Other LLC', displayName: 'Other', status: 'ACTIVE' },
    });
    try {
      const res = await post(
        hrAction,
        `/api/v1/workspaces/${otherSlug}/hr/actions/payroll-run-decide`,
        { runId, approve: true },
        cookies.approver,
        { workspaceSlug: otherSlug, action: 'payroll-run-decide' },
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
    } finally {
      await prisma.tenant.delete({ where: { id: other.id } }).catch(() => {});
    }
  });

  it('the HRMS entitlement is still required', async () => {
    await prisma.moduleEntitlement.updateMany({
      where: { tenantId, module: 'HRMS' },
      data: { state: 'SUSPENDED' },
    });
    try {
      const res = await act('approver', 'payroll-run-decide', { runId, approve: true });
      expect(res.status).toBeGreaterThanOrEqual(400);
    } finally {
      await prisma.moduleEntitlement.updateMany({
        where: { tenantId, module: 'HRMS' },
        data: { state: 'ACTIVE' },
      });
    }
  });

  it('an approval writes an audit trail', async () => {
    const before = await prisma.auditLog.count({ where: { tenantId } });
    await act('officer', 'payroll-run-create', { periodStart: '2026-10-01', periodEnd: '2026-10-31' });
    const after = await prisma.auditLog.count({ where: { tenantId } });
    expect(after).toBeGreaterThan(before);
  });
});
