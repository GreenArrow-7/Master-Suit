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
 * The tests below pin both directions: the approver can approve, and nobody
 * gained anything else. A fix that widened `finance_admin`'s grants, or removed
 * the per-action assertion, fails here.
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

const act = (label: string, action: string, body: Record<string, unknown>) =>
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
  // Holds employee:VIEW and nothing payroll-related.
  await actor('bystander', [['employee', 'VIEW']]);
  // An ordinary employee: own record only, no payroll authority at all.
  await actor(
    'staff',
    [
      ['employee', 'VIEW'],
      ['leave', 'CREATE'],
    ],
    'OWN',
  );

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
    const decided = await act('officer', 'payroll-run-decide', { runId, approve: true });
    expect(decided.status).toBe(403);
  });

  it('the approver approves it — holding payroll:APPROVE and no employee:VIEW', async () => {
    const decided = await act('approver', 'payroll-run-decide', { runId, approve: true });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
  });
});

describe('nothing else was widened', () => {
  it('employee:VIEW alone does not approve payroll', async () => {
    const decided = await act('bystander', 'payroll-run-decide', { runId, approve: true });
    expect(decided.status).toBe(403);
  });

  it('the approver cannot create a run — APPROVE is not CREATE', async () => {
    const created = await act('approver', 'payroll-run-create', {
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
    expect(created.status).toBe(403);
  });

  it('the approver cannot reach an unrelated verb', async () => {
    const settings = await act('approver', 'settings-update', { workWeek: [1, 2, 3, 4, 5] });
    expect(settings.status).toBe(403);
  });
});

describe('self-service keeps the floor the kernel used to apply', () => {
  /**
   * Asserted as "authorised", not as "succeeded", and deliberately.
   *
   * This fixture's employee has no manager, so `applyForLeave` refuses with 409
   * "No approver is set up for this employee" — correct application behaviour
   * that has nothing to do with permissions. What this test exists to pin is
   * that the *authorisation* still lets a self-service verb through, which a 409
   * proves and a 403 would disprove. Asserting 200 here would be asserting the
   * fixture, not the control.
   */
  it('an ordinary employee is still authorised to apply for their own leave', async () => {
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
    await actor('outsider', [['leads', 'VIEW']]);
    const type = await prisma.hrLeaveType.findFirstOrThrow({ where: { tenantId } });
    const applied = await act('outsider', 'leave-apply', {
      leaveTypeId: type.id,
      startDate: '2026-11-10',
      endDate: '2026-11-11',
      reason: 'should not be authorised',
    });
    expect(applied.status).toBe(403);
  });
});
