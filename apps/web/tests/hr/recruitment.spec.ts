/**
 * Applicant tracking, and the controls on the way to an employee.
 *
 * The properties that matter:
 *
 *   1. a candidate reaches HIRED only through an offer somebody accepted —
 *      not by dragging a stage;
 *   2. the hire carries back to the application, so §109's chain survives;
 *   3. salary bands are a separate permission from reaching recruitment;
 *   4. interview feedback comes from the panel, not from whoever has the link;
 *   5. offers version rather than mutate.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  addCandidate,
  candidateDetail,
  createOffer,
  createRequisition,
  decideOffer,
  decideRequisition,
  hireCandidate,
  listRequisitions,
  mayMoveTo,
  moveCandidate,
  pipelineSummary,
  recordOfferResponse,
  scheduleInterview,
  sendOffer,
  startOnboardingForCandidate,
  submitFeedback,
  submitRequisition,
} from '@/services/hr/recruitment';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { PermissionMap } from '@/lib/security/rbac';

// ── Pure pipeline rules ────────────────────────────────────────────────────

describe('mayMoveTo', () => {
  it('advances and re-screens along the pipeline', () => {
    expect(mayMoveTo('APPLIED', 'SCREENING')).toBe(true);
    expect(mayMoveTo('APPLIED', 'INTERVIEW')).toBe(true);
    expect(mayMoveTo('INTERVIEW', 'SCREENING')).toBe(true);
  });

  it('lets anyone live be rejected, withdraw or go on hold', () => {
    expect(mayMoveTo('APPLIED', 'REJECTED')).toBe(true);
    expect(mayMoveTo('FINAL_INTERVIEW', 'WITHDRAWN')).toBe(true);
    expect(mayMoveTo('SCREENING', 'ON_HOLD')).toBe(true);
    expect(mayMoveTo('ON_HOLD', 'INTERVIEW')).toBe(true);
  });

  it('treats terminal stages as final', () => {
    // A rejected candidate is re-applied, not un-rejected: the pipeline metrics
    // depend on terminals staying terminal.
    expect(mayMoveTo('REJECTED', 'SCREENING')).toBe(false);
    expect(mayMoveTo('HIRED', 'OFFER')).toBe(false);
    expect(mayMoveTo('WITHDRAWN', 'APPLIED')).toBe(false);
  });

  it('reaches HIRED only from OFFER', () => {
    expect(mayMoveTo('OFFER', 'HIRED')).toBe(true);
    expect(mayMoveTo('INTERVIEW', 'HIRED')).toBe(false);
  });

  it('refuses a move to the stage already occupied', () => {
    expect(mayMoveTo('SCREENING', 'SCREENING')).toBe(false);
  });
});

// ── Workflow, against the real database ────────────────────────────────────

const suffix = randomBytes(4).toString('hex');
const slug = `ats-${suffix}`;

let tenantId = '';
let roleId = '';
const employees: Record<string, string> = {};
const userIds: Record<string, string> = {};

const permissions = (grants: readonly (readonly [string, string])[], scope = 'ORGANIZATION') =>
  new Map(grants.map(([module, action]) => [`${module}:${action}`, scope])) as PermissionMap;

const ctxFor = (label: string, grants: readonly (readonly [string, string])[]) =>
  buildCtx(buildActor({ id: userIds[label]!, tenantId, roleRank: 0, permissions: permissions(grants) }));

const RECRUITER = [
  ['recruitment', 'VIEW'],
  ['recruitment', 'CREATE'],
  ['recruitment', 'EDIT'],
  ['recruitment', 'VIEW_SENSITIVE_FIELDS'],
  ['employee', 'VIEW'],
  ['employee', 'EDIT'],
  ['users', 'MANAGE_USERS'],
] as const;
/** A coordinator who may run the pipeline but not read money. */
const COORDINATOR = [
  ['recruitment', 'VIEW'],
  ['recruitment', 'EDIT'],
  ['employee', 'VIEW'],
] as const;
const APPROVER = [
  ['recruitment', 'VIEW'],
  ['recruitment', 'APPROVE'],
  ['recruitment', 'VIEW_SENSITIVE_FIELDS'],
  ['employee', 'VIEW'],
] as const;
const OUTSIDER = [['employee', 'VIEW']] as const;

async function makeEmployee(label: string) {
  const email = `${label}-${suffix}@ats.test`;
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
    },
  });
  employees[label] = employee.id;
  userIds[label] = user.id;
}

const future = (days: number) => new Date(Date.now() + days * 86_400_000);

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'ATS LLC', displayName: 'ATS', status: 'ACTIVE', maxUsers: 100 },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });
  // `employee` is the role a hire is invited into, and the one inviteUser looks up.
  const role = await prisma.role.create({
    data: { tenantId, key: 'employee', name: 'Employee', rank: 90, defaultScope: 'OWN' },
  });
  roleId = role.id;
  await makeEmployee('recruiter');
  await makeEmployee('manager');
  await makeEmployee('interviewer');
  await makeEmployee('outsider');
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

/** A requisition taken all the way to OPEN, which is where candidates can apply. */
async function openRequisition(title = 'Sales Consultant') {
  const requisition = await createRequisition(ctxFor('recruiter', RECRUITER), {
    title,
    openings: 2,
    salaryMin: 8000,
    salaryMax: 12000,
    hiringManagerId: employees.manager,
    reason: 'Expansion',
  });
  await submitRequisition(ctxFor('recruiter', RECRUITER), requisition.id);
  await decideRequisition(ctxFor('recruiter', APPROVER), requisition.id, true);
  return requisition.id;
}

describe('requisitions', () => {
  it('needs approval before candidates can apply', async () => {
    const requisition = await createRequisition(ctxFor('recruiter', RECRUITER), { title: 'Draft Role' });
    expect(requisition.status).toBe('DRAFT');

    await expect(
      addCandidate(ctxFor('recruiter', RECRUITER), {
        requisitionId: requisition.id,
        fullName: 'Too Early',
        email: `early-${suffix}@example.test`,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('refuses the hiring manager approving their own headcount', async () => {
    const requisition = await createRequisition(ctxFor('recruiter', RECRUITER), {
      title: 'Own Headcount',
      hiringManagerId: employees.manager,
    });
    await submitRequisition(ctxFor('recruiter', RECRUITER), requisition.id);
    await expect(decideRequisition(ctxFor('manager', APPROVER), requisition.id, true)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('refuses a band from someone who cannot read bands', async () => {
    await expect(
      createRequisition(ctxFor('recruiter', COORDINATOR), { title: 'Banded', salaryMin: 5000, salaryMax: 9000 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('hides the band from a coordinator who may still run the pipeline', async () => {
    await openRequisition('Banded Role');
    const asRecruiter = await listRequisitions(ctxFor('recruiter', RECRUITER));
    const asCoordinator = await listRequisitions(ctxFor('recruiter', COORDINATOR));

    expect(asRecruiter.some((row) => row.salaryMin !== null)).toBe(true);
    expect(asCoordinator.every((row) => row.salaryMin === null && row.salaryMax === null)).toBe(true);
  });

  it('refuses recruitment entirely to someone without the permission', async () => {
    await expect(listRequisitions(ctxFor('outsider', OUTSIDER))).rejects.toMatchObject({ status: 403 });
  });
});

describe('candidates and the pipeline', () => {
  it('refuses the same person applying twice to one role', async () => {
    const requisitionId = await openRequisition('Duplicate Role');
    const email = `dupe-${suffix}@example.test`;
    await addCandidate(ctxFor('recruiter', RECRUITER), { requisitionId, fullName: 'Dupe', email });
    await expect(
      addCandidate(ctxFor('recruiter', RECRUITER), { requisitionId, fullName: 'Dupe', email }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('records every move, so the pipeline is reconstructable', async () => {
    const requisitionId = await openRequisition('Tracked Role');
    const candidate = await addCandidate(ctxFor('recruiter', RECRUITER), {
      requisitionId,
      fullName: 'Tracked',
      email: `tracked-${suffix}@example.test`,
    });
    await moveCandidate(ctxFor('recruiter', RECRUITER), candidate.id, 'SCREENING');
    await moveCandidate(ctxFor('recruiter', RECRUITER), candidate.id, 'INTERVIEW');

    const detail = await candidateDetail(ctxFor('recruiter', RECRUITER), candidate.id);
    expect(detail.stage).toBe('INTERVIEW');
    expect(detail.stageEvents.map((event) => event.toStage)).toEqual(['INTERVIEW', 'SCREENING', 'APPLIED']);
  });

  it('demands a reason when rejecting', async () => {
    const requisitionId = await openRequisition('Reject Role');
    const candidate = await addCandidate(ctxFor('recruiter', RECRUITER), {
      requisitionId,
      fullName: 'Rejected',
      email: `rejected-${suffix}@example.test`,
    });
    await expect(
      moveCandidate(ctxFor('recruiter', RECRUITER), candidate.id, 'REJECTED'),
    ).rejects.toMatchObject({ status: 409 });

    const rejected = await moveCandidate(ctxFor('recruiter', RECRUITER), candidate.id, 'REJECTED', 'Not enough UAE experience');
    expect(rejected.rejectionReason).toBe('Not enough UAE experience');
  });

  it('refuses a stage drag straight to hired', async () => {
    const requisitionId = await openRequisition('Shortcut Role');
    const candidate = await addCandidate(ctxFor('recruiter', RECRUITER), {
      requisitionId,
      fullName: 'Shortcut',
      email: `shortcut-${suffix}@example.test`,
    });
    await expect(
      moveCandidate(ctxFor('recruiter', RECRUITER), candidate.id, 'HIRED' as never),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('interviews', () => {
  it('accepts feedback from the panel and refuses it from anyone else', async () => {
    const requisitionId = await openRequisition('Interview Role');
    const candidate = await addCandidate(ctxFor('recruiter', RECRUITER), {
      requisitionId,
      fullName: 'Interviewee',
      email: `interviewee-${suffix}@example.test`,
    });
    const interview = await scheduleInterview(ctxFor('recruiter', RECRUITER), {
      candidateId: candidate.id,
      scheduledAt: future(3),
      panelIds: [employees.interviewer!],
    });

    await expect(
      submitFeedback(ctxFor('manager', APPROVER), {
        interviewId: interview.id,
        rating: 5,
        recommendation: 'STRONG_YES',
      }),
    ).rejects.toMatchObject({ status: 403 });

    const feedback = await submitFeedback(ctxFor('interviewer', COORDINATOR), {
      interviewId: interview.id,
      rating: 4,
      recommendation: 'YES',
      scores: { communication: 4, technical: 3 },
      notes: 'Strong on client handling.',
    });
    expect(feedback.rating).toBe(4);

    // The panel has all reported, so the interview closes itself.
    const closed = await prisma.hrInterview.findFirstOrThrow({ where: { tenantId, id: interview.id } });
    expect(closed.status).toBe('COMPLETED');
  });

  it('replaces an interviewer’s own scorecard rather than stacking a second', async () => {
    const interview = await prisma.hrInterview.findFirstOrThrow({ where: { tenantId } });
    await submitFeedback(ctxFor('interviewer', COORDINATOR), {
      interviewId: interview.id,
      rating: 2,
      recommendation: 'NO',
      notes: 'Revised after reference check.',
    });
    const all = await prisma.hrInterviewFeedback.findMany({ where: { tenantId, interviewId: interview.id } });
    expect(all).toHaveLength(1);
    expect(all[0]!.rating).toBe(2);
  });
});

describe('offers and the hire', () => {
  let candidateId = '';

  it('versions a renegotiated offer instead of editing it', async () => {
    const requisitionId = await openRequisition('Hire Role');
    const candidate = await addCandidate(ctxFor('recruiter', RECRUITER), {
      requisitionId,
      fullName: 'New Joiner',
      email: `joiner-${suffix}@example.test`,
    });
    candidateId = candidate.id;

    const first = await createOffer(ctxFor('recruiter', RECRUITER), {
      candidateId,
      basic: 8000,
      housing: 3000,
      joiningDate: future(30),
    });
    expect(first.version).toBe(1);

    const second = await createOffer(ctxFor('recruiter', RECRUITER), {
      candidateId,
      basic: 9000,
      housing: 3500,
      joiningDate: future(30),
    });
    expect(second.version).toBe(2);

    // The superseded offer must not stay outstanding, or two live offers exist.
    const superseded = await prisma.hrOffer.findFirstOrThrow({ where: { tenantId, id: first.id } });
    expect(superseded.status).toBe('WITHDRAWN');
  });

  it('refuses an offer from someone who cannot read compensation', async () => {
    await expect(
      createOffer(ctxFor('recruiter', COORDINATOR), { candidateId, basic: 1000, joiningDate: future(30) }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a hire before the offer is accepted', async () => {
    await expect(
      hireCandidate(ctxFor('recruiter', RECRUITER), { candidateId, employeeNumber: `NEW-${suffix}` }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('runs approve → send → accept', async () => {
    const offer = await prisma.hrOffer.findFirstOrThrow({ where: { tenantId, candidateId, version: 2 } });
    await decideOffer(ctxFor('manager', APPROVER), offer.id, true);
    await sendOffer(ctxFor('recruiter', RECRUITER), offer.id);

    const candidate = await prisma.hrCandidate.findFirstOrThrow({ where: { tenantId, id: candidateId } });
    expect(candidate.stage).toBe('OFFER');

    const accepted = await recordOfferResponse(ctxFor('recruiter', RECRUITER), offer.id, true);
    expect(accepted.status).toBe('ACCEPTED');
  });

  it('hires by issuing an invitation that carries the candidate and the start date', async () => {
    const hired = await hireCandidate(ctxFor('recruiter', RECRUITER), {
      candidateId,
      employeeNumber: `NEW-${suffix}`,
    });
    expect(hired.stage).toBe('HIRED');

    // §109: the invitation is what carries the trail, because the employee
    // record does not exist until it is accepted.
    const invitation = await prisma.workspaceInvitation.findFirstOrThrow({
      where: { tenantId, candidateId },
    });
    expect(invitation.employeeNumber).toBe(`NEW-${suffix}`);
    const offer = await prisma.hrOffer.findFirstOrThrow({ where: { tenantId, candidateId, version: 2 } });
    expect(invitation.joiningDate?.toISOString()).toBe(offer.joiningDate.toISOString());
  });

  it('refuses onboarding until the invitation has been accepted', async () => {
    await expect(
      startOnboardingForCandidate(ctxFor('recruiter', RECRUITER), candidateId),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('links the employee back to the application once accepted, and onboards', async () => {
    // Standing in for acceptance, which is an unauthenticated flow with its own
    // suite: what matters here is that an employee carrying the link onboards.
    const platformUser = await prisma.platformUser.create({
      data: {
        email: `joiner-${suffix}@example.test`,
        normalizedEmail: `joiner2-${suffix}@example.test`,
        fullName: 'New Joiner',
        status: 'ACTIVE',
      },
    });
    const user = await prisma.user.create({
      data: { tenantId, email: `joiner2-${suffix}@example.test`, fullName: 'New Joiner', roleId, status: 'ACTIVE' },
    });
    const membership = await prisma.workspaceMembership.create({
      data: { tenantId, platformUserId: platformUser.id, salesUserId: user.id, status: 'ACTIVE', joinedAt: new Date() },
    });
    await prisma.employeeProfile.create({
      data: {
        tenantId,
        membershipId: membership.id,
        employeeNumber: `NEW-${suffix}`,
        employmentStatus: 'ONBOARDING',
        joinedOn: future(30),
        hiredFromCandidateId: candidateId,
      },
    });

    const result = await startOnboardingForCandidate(ctxFor('recruiter', RECRUITER), candidateId);
    expect(result).toBeTruthy();

    const detail = await candidateDetail(ctxFor('recruiter', RECRUITER), candidateId);
    expect(detail.employees).toHaveLength(1);
    expect(detail.employees[0]!.employeeNumber).toBe(`NEW-${suffix}`);
  });

  it('redacts offered compensation from a coordinator', async () => {
    const detail = await candidateDetail(ctxFor('recruiter', COORDINATOR), candidateId);
    expect(detail.offers.every((offer) => offer.basic === null)).toBe(true);
  });
});

describe('pipeline reporting', () => {
  it('counts candidates by stage and measures time to hire', async () => {
    const summary = await pipelineSummary(ctxFor('recruiter', RECRUITER));
    expect(summary.openRequisitions).toBeGreaterThan(0);
    expect(summary.byStage.HIRED).toBe(1);
    expect(summary.hires).toBe(1);
    // Applied and hired within the same test run, so the span rounds to zero
    // days — what matters is that it is measured, not left null.
    expect(summary.averageDaysToHire).not.toBeNull();
  });
});
