/**
 * Performance: the ordering, and who may read what.
 *
 * §53 asks for strict permissions on performance data, and these cases are the
 * proof:
 *
 *   1. the employee writes first, so a manager cannot rate before reading it;
 *   2. an employee cannot read the manager's assessment of them until it has
 *      been calibrated and released;
 *   3. a manager sees their own reports and nobody else's;
 *   4. only the employee acknowledges, so nothing closes behind their back;
 *   5. a PIP the employee never acknowledged cannot be closed as a failure.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  acknowledgePip,
  acknowledgeReview,
  activatePip,
  calibrateReview,
  closePip,
  createCycle,
  createPip,
  goalsFor,
  openCycle,
  performanceSummary,
  pipsFor,
  recordCheckpoint,
  reviewsFor,
  seedCompetencies,
  setGoal,
  submitManagerReview,
  submitSelfReview,
} from '@/services/hr/performance';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { PermissionMap } from '@/lib/security/rbac';

const suffix = randomBytes(4).toString('hex');
const slug = `perf-${suffix}`;

let tenantId = '';
let roleId = '';
let cycleId = '';
const employees: Record<string, string> = {};
const userIds: Record<string, string> = {};

const permissions = (grants: readonly (readonly [string, string])[], scope = 'ORGANIZATION') =>
  new Map(grants.map(([module, action]) => [`${module}:${action}`, scope])) as PermissionMap;

const ctxFor = (label: string, grants: readonly (readonly [string, string])[], scope = 'ORGANIZATION') =>
  buildCtx(buildActor({ id: userIds[label]!, tenantId, permissions: permissions(grants, scope) }));

const HR = [
  ['performance', 'VIEW'],
  ['performance', 'APPROVE'],
  ['performance', 'EDIT'],
  ['performance', 'CREATE'],
  ['employee', 'VIEW'],
] as const;
/** A line manager: may write reviews, but only inside their reporting line. */
const MANAGER = [
  ['performance', 'EDIT'],
  ['performance', 'CREATE'],
  ['employee', 'VIEW'],
] as const;
const STAFF = [['employee', 'VIEW']] as const;

async function makeEmployee(label: string, managerMembershipId?: string) {
  const email = `${label}-${suffix}@perf.test`;
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: label, status: 'ACTIVE' },
  });
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: label, roleId, status: 'ACTIVE' },
  });
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
  });
  const employee = await prisma.employeeProfile.create({
    data: {
      tenantId,
      membershipId: membership.id,
      employeeNumber: `${label.toUpperCase()}-${suffix}`,
      employmentStatus: 'ACTIVE',
      joinedOn: new Date('2020-01-01'),
      managerMembershipId: managerMembershipId ?? null,
    },
  });
  employees[label] = employee.id;
  userIds[label] = user.id;
  return membership.id;
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Perf LLC', displayName: 'Perf', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });
  const role = await prisma.role.create({
    data: { tenantId, key: 'employee', name: 'Employee', rank: 90, defaultScope: 'OWN' },
  });
  roleId = role.id;

  const managerMembership = await makeEmployee('manager');
  await makeEmployee('report', managerMembership);
  await makeEmployee('stranger');
  await makeEmployee('hr');
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

describe('cycles', () => {
  it('creates one review per eligible employee when opened', async () => {
    const cycle = await createCycle(ctxFor('hr', HR), {
      name: `2026 Annual ${suffix}`,
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-12-31'),
    });
    cycleId = cycle.id;
    expect(cycle.status).toBe('DRAFT');

    const opened = await openCycle(ctxFor('hr', HR), cycleId);
    // Materialised up front so "overdue" is answerable: a missing row is
    // indistinguishable from a manager who has not started.
    expect(opened.reviewsCreated).toBe(4);

    const reviews = await prisma.hrReview.findMany({ where: { tenantId, cycleId } });
    expect(reviews.every((review) => review.status === 'PENDING_SELF')).toBe(true);
    // The reporting line is carried onto the review at creation.
    const reportReview = reviews.find((review) => review.employeeId === employees.report);
    expect(reportReview?.managerId).toBe(employees.manager);
  });

  it('refuses to open the same cycle twice', async () => {
    await expect(openCycle(ctxFor('hr', HR), cycleId)).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a cycle from someone who is not HR', async () => {
    await expect(
      createCycle(ctxFor('manager', MANAGER), {
        name: 'Unauthorised',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-06-30'),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('seeds a competency framework idempotently', async () => {
    const first = await seedCompetencies(ctxFor('hr', HR));
    expect(first.created).toBeGreaterThan(0);
    const second = await seedCompetencies(ctxFor('hr', HR));
    expect(second.created).toBe(0);
  });
});

describe('goals', () => {
  it('refuses a goal set that would exceed 100% weight', async () => {
    const ctx = ctxFor('report', STAFF);
    await setGoal(ctx, { cycleId, title: 'Close 20 deals', weight: 60 });
    await setGoal(ctx, { cycleId, title: 'Improve CSAT', weight: 30 });
    // 60 + 30 + 20 = 110. A goal sheet over 100% produces a rating nobody can
    // defend, and it is only visible by looking at the set.
    await expect(setGoal(ctx, { cycleId, title: 'Mentoring', weight: 20 })).rejects.toMatchObject({ status: 409 });
  });

  it('lets a manager set a goal for their report but not for a stranger', async () => {
    await setGoal(ctxFor('manager', MANAGER), {
      employeeId: employees.report,
      cycleId,
      title: 'Manager-set objective',
      weight: 10,
    });
    await expect(
      setGoal(ctxFor('manager', MANAGER), { employeeId: employees.stranger, title: 'Not mine' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('shows an employee their own goals and refuses a colleague’s', async () => {
    const mine = await goalsFor(ctxFor('report', STAFF));
    expect(mine.length).toBeGreaterThan(0);
    await expect(goalsFor(ctxFor('report', STAFF), employees.stranger)).rejects.toMatchObject({ status: 403 });
  });
});

describe('the review, in order', () => {
  let reviewId = '';

  beforeAll(async () => {
    const review = await prisma.hrReview.findFirstOrThrow({
      where: { tenantId, cycleId, employeeId: employees.report },
    });
    reviewId = review.id;
  });

  it('refuses a manager review before the self-assessment exists', async () => {
    // The ordering is the point of having two: a manager who rates first is
    // simply rating without the input.
    await expect(
      submitManagerReview(ctxFor('manager', MANAGER), { reviewId, comments: 'Early', rating: 3 }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('lets only the employee write the self-assessment', async () => {
    await expect(
      submitSelfReview(ctxFor('manager', MANAGER), { reviewId, comments: 'Not mine to write' }),
    ).rejects.toMatchObject({ status: 403 });

    const updated = await submitSelfReview(ctxFor('report', STAFF), {
      reviewId,
      comments: 'Strong year on pipeline discipline.',
      rating: 4,
    });
    expect(updated.status).toBe('PENDING_MANAGER');
  });

  it('refuses a second self-assessment', async () => {
    await expect(submitSelfReview(ctxFor('report', STAFF), { reviewId, comments: 'Again' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('refuses a manager review from someone outside the reporting line', async () => {
    await expect(
      submitManagerReview(ctxFor('stranger', MANAGER), { reviewId, comments: 'Not my report', rating: 2 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('accepts the manager review from the actual line manager', async () => {
    const updated = await submitManagerReview(ctxFor('manager', MANAGER), {
      reviewId,
      comments: 'Agree on pipeline; needs work on forecasting.',
      rating: 3,
    });
    expect(updated.status).toBe('CALIBRATION');
  });

  it('hides the manager’s assessment from the employee until it is released', async () => {
    const asEmployee = await reviewsFor(ctxFor('report', STAFF), { cycleId });
    const own = asEmployee.find((review) => review.id === reviewId)!;
    expect(own.selfComments).toBeTruthy();
    // Still in CALIBRATION: the rating may yet move, and an employee reading a
    // draft changes the conversation permanently.
    expect(own.managerRating).toBeNull();
    expect(own.managerComments).toBeNull();

    // HR sees the whole thing throughout.
    const asHr = await reviewsFor(ctxFor('hr', HR), { cycleId, employeeId: employees.report });
    expect(asHr[0]!.managerRating).toBe(3);
  });

  it('records calibration separately from the manager’s rating', async () => {
    await expect(calibrateReview(ctxFor('manager', MANAGER), reviewId, 4)).rejects.toMatchObject({ status: 403 });

    const calibrated = await calibrateReview(ctxFor('hr', HR), reviewId, 4, 'Moved up for cross-team consistency.');
    expect(calibrated.finalRating).toBe(4);
    // The manager's own number survives, which is what an employee disputing a
    // rating needs to see.
    expect(calibrated.managerRating).toBe(3);
    expect(calibrated.status).toBe('AWAITING_ACKNOWLEDGEMENT');
  });

  it('releases the manager’s assessment once calibrated', async () => {
    const asEmployee = await reviewsFor(ctxFor('report', STAFF), { cycleId });
    const own = asEmployee.find((review) => review.id === reviewId)!;
    expect(own.managerRating).toBe(3);
    expect(own.finalRating).toBe(4);
  });

  it('lets only the employee acknowledge', async () => {
    await expect(acknowledgeReview(ctxFor('manager', MANAGER), reviewId)).rejects.toMatchObject({ status: 403 });
    const done = await acknowledgeReview(ctxFor('report', STAFF), reviewId, 'Noted, thank you.');
    expect(done.status).toBe('COMPLETE');
  });
});

describe('visibility', () => {
  it('gives a manager their reports and themselves, not the workspace', async () => {
    const visible = await reviewsFor(ctxFor('manager', MANAGER), { cycleId });
    const ids = visible.map((review) => review.employeeId);
    expect(ids).toContain(employees.report);
    expect(ids).toContain(employees.manager);
    expect(ids).not.toContain(employees.stranger);
  });

  it('gives HR everyone', async () => {
    const visible = await reviewsFor(ctxFor('hr', HR), { cycleId });
    expect(visible).toHaveLength(4);
  });
});

describe('improvement plans', () => {
  let pipId = '';
  let checkpointId = '';

  it('is created by the line manager with checkpoints', async () => {
    const pip = await createPip(ctxFor('manager', MANAGER), {
      employeeId: employees.report!,
      objective: 'Forecast accuracy within 10%',
      expectedImprovements: 'Weekly pipeline review submitted on time, forecast variance under 10%.',
      startsOn: new Date('2026-02-01'),
      endsOn: new Date('2026-04-30'),
      checkpoints: [
        { dueOn: new Date('2026-02-28'), expectation: 'First month variance under 20%' },
        { dueOn: new Date('2026-03-31'), expectation: 'Second month variance under 15%' },
      ],
    });
    pipId = pip.id;
    checkpointId = pip.checkpoints[0]!.id;
    expect(pip.checkpoints).toHaveLength(2);
    expect(pip.status).toBe('DRAFT');
  });

  it('refuses a plan for someone outside the reporting line', async () => {
    await expect(
      createPip(ctxFor('manager', MANAGER), {
        employeeId: employees.stranger!,
        objective: 'Not mine',
        expectedImprovements: 'Not mine',
        startsOn: new Date('2026-02-01'),
        endsOn: new Date('2026-03-01'),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses to close an unacknowledged plan as a failure', async () => {
    await activatePip(ctxFor('manager', MANAGER), pipId);
    // The most expensive mistake available here: closing a plan the employee was
    // never recorded as having been told about.
    await expect(closePip(ctxFor('manager', MANAGER), pipId, false, 'Did not improve')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('lets only the employee acknowledge, and then closes', async () => {
    await expect(acknowledgePip(ctxFor('manager', MANAGER), pipId)).rejects.toMatchObject({ status: 403 });
    await acknowledgePip(ctxFor('report', STAFF), pipId, 'Understood.');

    await recordCheckpoint(ctxFor('manager', MANAGER), checkpointId, { met: true, managerComment: 'On track.' });
    const closed = await closePip(ctxFor('manager', MANAGER), pipId, true, 'Forecast variance now under 8%.');
    expect(closed.status).toBe('COMPLETED_SUCCESS');
  });

  it('shows an employee their own plan', async () => {
    const mine = await pipsFor(ctxFor('report', STAFF));
    expect(mine).toHaveLength(1);
    await expect(pipsFor(ctxFor('report', STAFF), employees.stranger)).rejects.toMatchObject({ status: 403 });
  });
});

describe('summary', () => {
  it('reports rating distribution and outstanding reviews within scope', async () => {
    const hrView = await performanceSummary(ctxFor('hr', HR), cycleId);
    expect(hrView.ratingDistribution['4']).toBe(1);
    // Three of the four reviews are still sitting at PENDING_SELF.
    expect(hrView.outstanding).toBe(3);

    // A manager's summary counts only their own line, which is the whole point
    // of scoping it rather than showing everyone the company distribution.
    const managerView = await performanceSummary(ctxFor('manager', MANAGER), cycleId);
    expect(managerView.outstanding).toBeLessThan(hrView.outstanding);
  });
});
