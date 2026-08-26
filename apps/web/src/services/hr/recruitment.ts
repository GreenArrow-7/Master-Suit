/**
 * Applicant tracking, ending in an employee.
 *
 * The original HRMS declared `recruitment.manage` and had no recruitment; this
 * is the module behind it. Its reason to exist is the last step rather than the
 * first: §109 wants requisition → candidate → interviews → offer → accepted →
 * hired → employee record → onboarding, with the trail intact at the end. So the
 * hire is not a status change that leaves someone to re-key a name into the
 * employee screen — it issues the invitation, and the employee record created on
 * acceptance carries `hiredFromCandidateId` back to the application.
 *
 * Two rules shape the rest:
 *
 * Salary bands are separately permissioned. A recruiter scheduling interviews
 * does not thereby get to read every band in the company, so `redactBand` strips
 * them unless the caller holds `recruitment:VIEW_SENSITIVE_FIELDS` — the same
 * separation §90 draws around payroll.
 *
 * Offers are versioned by row. A renegotiated offer is a new version, never an
 * edit, so what the candidate was actually sent stays readable after the terms
 * move.
 */
import { Prisma } from '@prisma/client';
import { prisma, withTx } from '@/lib/db';
import { Conflict, Forbidden, NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { toDay } from './rules';
import { myEmployee } from './leave';
import { startOnboarding } from './lifecycle';
import { inviteUser } from '@/services/identity/invitations';
import { EMPLOYEE_WITH_PERSON } from './publicSelect';
import {
  notifyInterviewScheduled,
  notifyOfferResponded,
  notifyRequisitionDecided,
  notifyRequisitionSubmitted,
} from './notify';

/**
 * Declared as a literal union rather than pulled from the generated client:
 * `Prisma.$Enums` is not exported by this client version, and the rest of the HR
 * services already spell their enums out this way.
 */
export type Stage =
  | 'APPLIED'
  | 'SCREENING'
  | 'SHORTLISTED'
  | 'INTERVIEW'
  | 'ASSESSMENT'
  | 'FINAL_INTERVIEW'
  | 'OFFER'
  | 'HIRED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'ON_HOLD';

export type RequisitionStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'OPEN' | 'ON_HOLD' | 'CLOSED' | 'REJECTED';

export const mayReadRecruitment = (ctx: Ctx) => SCOPE_RANK[scopeFor(ctx, 'recruitment', 'VIEW')] >= SCOPE_RANK.TEAM;
export const isRecruiter = (ctx: Ctx) => SCOPE_RANK[scopeFor(ctx, 'recruitment', 'EDIT')] >= SCOPE_RANK.TEAM;
export const isHiringApprover = (ctx: Ctx) =>
  SCOPE_RANK[scopeFor(ctx, 'recruitment', 'APPROVE')] >= SCOPE_RANK.ORGANIZATION;
/** Reads salary bands and offered compensation. */
export const mayReadBands = (ctx: Ctx) =>
  SCOPE_RANK[scopeFor(ctx, 'recruitment', 'VIEW_SENSITIVE_FIELDS')] >= SCOPE_RANK.ORGANIZATION;

const requireRecruiter = (ctx: Ctx) => {
  if (!isRecruiter(ctx)) throw Forbidden('Your role does not allow changing recruitment records.');
};

/**
 * Which stage may follow which.
 *
 * Not a straight line: a candidate can be rejected or withdraw from anywhere,
 * and screening can send someone back. What this forbids is skipping into HIRED
 * without an accepted offer, which `hireCandidate` enforces separately, and
 * moving out of a terminal stage — a rejected candidate is re-applied, not
 * un-rejected, because the pipeline metrics depend on terminals being final.
 */
const TERMINAL: Stage[] = ['HIRED', 'REJECTED', 'WITHDRAWN'];
const PROGRESSION: Stage[] = [
  'APPLIED',
  'SCREENING',
  'SHORTLISTED',
  'INTERVIEW',
  'ASSESSMENT',
  'FINAL_INTERVIEW',
  'OFFER',
  'HIRED',
];

export function mayMoveTo(from: Stage, to: Stage): boolean {
  if (from === to) return false;
  if (TERMINAL.includes(from)) return false;
  if (to === 'HIRED') return from === 'OFFER';
  // Rejection, withdrawal and a hold are reachable from anywhere still live.
  if (['REJECTED', 'WITHDRAWN', 'ON_HOLD'].includes(to)) return true;
  if (from === 'ON_HOLD') return PROGRESSION.includes(to);
  const fromIndex = PROGRESSION.indexOf(from);
  const toIndex = PROGRESSION.indexOf(to);
  // Forwards by any number of steps, or back to an earlier stage for a re-screen.
  return fromIndex >= 0 && toIndex >= 0;
}

/** Strips salary figures for a caller who may not read them. */
function redactBand<T extends { salaryMin: unknown; salaryMax: unknown }>(row: T, allowed: boolean): T {
  return allowed ? row : { ...row, salaryMin: null, salaryMax: null };
}

// ── Requisitions ───────────────────────────────────────────────────────────

export interface RequisitionInput {
  title: string;
  departmentId?: string;
  hiringManagerId?: string;
  recruiterId?: string;
  openings?: number;
  employmentType?: string;
  locationId?: string;
  salaryMin?: number;
  salaryMax?: number;
  description?: string;
  skills?: string[];
  reason?: string;
  isInternal?: boolean;
}

export async function createRequisition(ctx: Ctx, input: RequisitionInput) {
  requireRecruiter(ctx);
  if (!input.title.trim()) throw Conflict('Give the role a title.');
  if ((input.openings ?? 1) < 1) throw Conflict('A requisition needs at least one opening.');
  if (input.salaryMin != null && input.salaryMax != null && input.salaryMax < input.salaryMin)
    throw Conflict('The top of the salary band cannot be below the bottom.');
  // Setting a band you cannot read would let a recruiter write a number they are
  // then shown a redacted view of, which reads as data loss.
  if ((input.salaryMin != null || input.salaryMax != null) && !mayReadBands(ctx))
    throw Forbidden('Your role does not allow setting a salary band.');

  const actor = await myEmployee(ctx);
  const requisition = await prisma.hrRequisition.create({
    data: {
      tenantId: ctx.tenantId,
      title: input.title.trim(),
      departmentId: input.departmentId || null,
      hiringManagerId: input.hiringManagerId || null,
      recruiterId: input.recruiterId || null,
      openings: input.openings ?? 1,
      employmentType: input.employmentType || null,
      locationId: input.locationId || null,
      salaryMin: input.salaryMin ?? null,
      salaryMax: input.salaryMax ?? null,
      description: input.description || null,
      skills: input.skills ?? [],
      reason: input.reason || null,
      isInternal: input.isInternal ?? false,
      createdById: actor?.id ?? null,
    },
  });

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_requisition',
    recordId: requisition.id,
    metadata: { action: 'recruitment.requisition.created', title: requisition.title, openings: requisition.openings },
  });
  return requisition;
}

export async function submitRequisition(ctx: Ctx, requisitionId: string) {
  requireRecruiter(ctx);
  const requisition = await prisma.hrRequisition.findFirst({ where: { tenantId: ctx.tenantId, id: requisitionId } });
  if (!requisition) throw NotFound('Requisition');
  if (requisition.status !== 'DRAFT') throw Conflict('Only a draft requisition can be submitted.');

  const updated = await prisma.hrRequisition.update({
    where: { tenantId: ctx.tenantId, id: requisition.id },
    data: { status: 'PENDING_APPROVAL' },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_requisition',
    recordId: requisition.id,
    metadata: { action: 'recruitment.requisition.submitted', previousStatus: requisition.status },
  });
  await notifyRequisitionSubmitted(ctx, { title: requisition.title, recordId: requisition.id });
  return updated;
}

/** Approving opens the vacancy; rejecting sends it back with a reason. */
export async function decideRequisition(ctx: Ctx, requisitionId: string, approve: boolean, note?: string) {
  if (!isHiringApprover(ctx)) throw Forbidden('Your role does not allow approving a requisition.');
  const requisition = await prisma.hrRequisition.findFirst({ where: { tenantId: ctx.tenantId, id: requisitionId } });
  if (!requisition) throw NotFound('Requisition');
  if (requisition.status !== 'PENDING_APPROVAL') throw Conflict('Only a requisition awaiting approval can be decided.');

  const actor = await myEmployee(ctx);
  // Hiring into your own team is normal; approving your own request to do it is
  // not — the headcount decision is the thing the approval exists for.
  if (actor && actor.id === requisition.hiringManagerId)
    throw Conflict('You raised this requisition as hiring manager, so somebody else must approve it.');

  const updated = await prisma.hrRequisition.update({
    where: { tenantId: ctx.tenantId, id: requisition.id },
    data: {
      status: approve ? 'OPEN' : 'REJECTED',
      approvedById: actor?.id ?? null,
      approvedAt: approve ? new Date() : null,
      decisionNote: note?.trim() || null,
    },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_requisition',
    recordId: requisition.id,
    metadata: { action: approve ? 'recruitment.requisition.approved' : 'recruitment.requisition.rejected' },
  });
  await notifyRequisitionDecided(ctx, {
    recruiterId: requisition.recruiterId ?? requisition.createdById,
    approved: approve,
    title: requisition.title,
    recordId: requisition.id,
  });
  return updated;
}

export async function setRequisitionStatus(ctx: Ctx, requisitionId: string, status: 'OPEN' | 'ON_HOLD' | 'CLOSED') {
  requireRecruiter(ctx);
  const requisition = await prisma.hrRequisition.findFirst({ where: { tenantId: ctx.tenantId, id: requisitionId } });
  if (!requisition) throw NotFound('Requisition');
  if (['DRAFT', 'PENDING_APPROVAL', 'REJECTED'].includes(requisition.status))
    throw Conflict('That requisition has not been approved yet.');

  const updated = await prisma.hrRequisition.update({
    where: { tenantId: ctx.tenantId, id: requisition.id },
    data: { status, closedAt: status === 'CLOSED' ? new Date() : null },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_requisition',
    recordId: requisition.id,
    metadata: { action: 'recruitment.requisition.status', from: requisition.status, to: status },
  });
  return updated;
}

export async function listRequisitions(ctx: Ctx, options: { status?: string } = {}) {
  if (!mayReadRecruitment(ctx)) throw Forbidden('Your role does not allow reading recruitment.');
  const rows = await prisma.hrRequisition.findMany({
    where: { tenantId: ctx.tenantId, status: options.status as RequisitionStatus | undefined },
    include: {
      department: true,
      hiringManager: EMPLOYEE_WITH_PERSON,
      recruiter: EMPLOYEE_WITH_PERSON,
      _count: { select: { candidates: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const bands = mayReadBands(ctx);
  return rows.map((row) => redactBand(row, bands));
}

// ── Candidates ─────────────────────────────────────────────────────────────

export interface CandidateInput {
  requisitionId: string;
  fullName: string;
  email: string;
  phone?: string;
  source?: string;
  experienceYears?: number;
  skills?: string[];
  resumeDocumentId?: string;
  notes?: string;
}

export async function addCandidate(ctx: Ctx, input: CandidateInput) {
  requireRecruiter(ctx);
  const requisition = await prisma.hrRequisition.findFirst({
    where: { tenantId: ctx.tenantId, id: input.requisitionId },
  });
  if (!requisition) throw NotFound('Requisition');
  // Applying to a role that was never approved, or is already filled and closed,
  // produces a pipeline nobody is going to act on.
  if (requisition.status !== 'OPEN') throw Conflict('That requisition is not open for applications.');

  const actor = await myEmployee(ctx);
  try {
    const candidate = await prisma.hrCandidate.create({
      data: {
        tenantId: ctx.tenantId,
        requisitionId: requisition.id,
        fullName: input.fullName.trim(),
        email: input.email.trim().toLowerCase(),
        phone: input.phone?.trim() || null,
        source: input.source?.trim() || null,
        experienceYears: input.experienceYears ?? null,
        skills: input.skills ?? [],
        resumeDocumentId: input.resumeDocumentId || null,
        notes: input.notes?.trim() || null,
        createdById: actor?.id ?? null,
        stageEvents: { create: { tenantId: ctx.tenantId, toStage: 'APPLIED', changedById: actor?.id ?? null } },
      },
    });
    await audit(ctx, {
      event: 'RECORD_CREATED',
      objectType: 'hr_candidate',
      recordId: candidate.id,
      metadata: { action: 'recruitment.candidate.added', requisitionId: requisition.id, source: candidate.source },
    });
    return candidate;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw Conflict('That person has already applied to this role.');
    throw error;
  }
}

export async function moveCandidate(ctx: Ctx, candidateId: string, toStage: Stage, note?: string) {
  requireRecruiter(ctx);
  const candidate = await prisma.hrCandidate.findFirst({ where: { tenantId: ctx.tenantId, id: candidateId } });
  if (!candidate) throw NotFound('Candidate');
  // HIRED is reached through `hireCandidate`, which needs an accepted offer.
  if (toStage === 'HIRED') throw Conflict('Complete the hire from the accepted offer rather than moving the stage.');
  if (!mayMoveTo(candidate.stage, toStage))
    throw Conflict(`A candidate cannot move from ${candidate.stage.toLowerCase()} to ${toStage.toLowerCase()}.`);
  if (toStage === 'REJECTED' && !note?.trim())
    throw Conflict('Give a reason when rejecting — it is what makes the pipeline reviewable.');

  const actor = await myEmployee(ctx);
  const updated = await withTx(ctx.tenantId, async (tx) => {
    await tx.hrCandidateStageEvent.create({
      data: {
        tenantId: ctx.tenantId,
        candidateId: candidate.id,
        fromStage: candidate.stage,
        toStage,
        note: note?.trim() || null,
        changedById: actor?.id ?? null,
      },
    });
    return tx.hrCandidate.update({
      where: { tenantId: ctx.tenantId, id: candidate.id },
      data: { stage: toStage, rejectionReason: toStage === 'REJECTED' ? note?.trim() || null : null },
    });
  });

  await audit(ctx, {
    event: 'STAGE_CHANGED',
    objectType: 'hr_candidate',
    recordId: candidate.id,
    metadata: { action: 'recruitment.candidate.moved', from: candidate.stage, to: toStage },
  });
  return updated;
}

export async function listCandidates(ctx: Ctx, options: { requisitionId?: string; stage?: Stage } = {}) {
  if (!mayReadRecruitment(ctx)) throw Forbidden('Your role does not allow reading recruitment.');
  return prisma.hrCandidate.findMany({
    where: { tenantId: ctx.tenantId, requisitionId: options.requisitionId, stage: options.stage },
    include: { requisition: { select: { id: true, title: true, status: true } } },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
}

export async function candidateDetail(ctx: Ctx, candidateId: string) {
  if (!mayReadRecruitment(ctx)) throw Forbidden('Your role does not allow reading recruitment.');
  const candidate = await prisma.hrCandidate.findFirst({
    where: { tenantId: ctx.tenantId, id: candidateId },
    include: {
      requisition: { include: { department: true } },
      stageEvents: { orderBy: { createdAt: 'desc' } },
      interviews: {
        include: { feedback: { include: { interviewer: EMPLOYEE_WITH_PERSON } } },
        orderBy: { scheduledAt: 'desc' },
      },
      offers: { orderBy: { version: 'desc' } },
      employees: { select: { id: true, employeeNumber: true } },
    },
  });
  if (!candidate) throw NotFound('Candidate');

  if (!mayReadBands(ctx)) {
    return {
      ...candidate,
      requisition: redactBand(candidate.requisition, false),
      // Offered compensation is the same class of information as the band.
      offers: candidate.offers.map((offer) => ({
        ...offer,
        basic: null,
        housing: null,
        transport: null,
        otherAllowance: null,
      })),
    };
  }
  return candidate;
}

// ── Interviews ─────────────────────────────────────────────────────────────

export interface InterviewInput {
  candidateId: string;
  scheduledAt: Date;
  durationMinutes?: number;
  type?: 'PHONE' | 'VIDEO' | 'ONSITE' | 'PANEL' | 'TECHNICAL';
  location?: string;
  panelIds: string[];
}

export async function scheduleInterview(ctx: Ctx, input: InterviewInput) {
  requireRecruiter(ctx);
  const candidate = await prisma.hrCandidate.findFirst({ where: { tenantId: ctx.tenantId, id: input.candidateId } });
  if (!candidate) throw NotFound('Candidate');
  if (TERMINAL.includes(candidate.stage)) throw Conflict(`That candidate is already ${candidate.stage.toLowerCase()}.`);
  if (!input.panelIds.length) throw Conflict('Name at least one interviewer.');

  const panel = await prisma.employeeProfile.findMany({
    where: { tenantId: ctx.tenantId, id: { in: input.panelIds }, deletedAt: null },
    select: { id: true },
  });
  if (panel.length !== new Set(input.panelIds).size) throw NotFound('Interviewer');

  const actor = await myEmployee(ctx);
  const interview = await prisma.hrInterview.create({
    data: {
      tenantId: ctx.tenantId,
      candidateId: candidate.id,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes ?? 60,
      type: input.type ?? 'VIDEO',
      location: input.location?.trim() || null,
      panelIds: [...new Set(input.panelIds)],
      createdById: actor?.id ?? null,
    },
  });

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_interview',
    recordId: interview.id,
    metadata: {
      action: 'recruitment.interview.scheduled',
      candidateId: candidate.id,
      panel: interview.panelIds.length,
    },
  });
  await notifyInterviewScheduled(ctx, {
    panelIds: interview.panelIds,
    candidateName: candidate.fullName,
    when: interview.scheduledAt,
    candidateId: candidate.id,
  });
  return interview;
}

export interface FeedbackInput {
  interviewId: string;
  rating: number;
  recommendation: 'STRONG_YES' | 'YES' | 'NEUTRAL' | 'NO' | 'STRONG_NO';
  scores?: Record<string, number>;
  notes?: string;
}

/**
 * An interviewer's scorecard.
 *
 * Restricted to the panel: feedback from someone who was not in the room is not
 * evidence, and a hiring decision defended with it does not survive review.
 * Re-submitting replaces your own, so a correction is possible without opening
 * the door to editing somebody else's.
 */
export async function submitFeedback(ctx: Ctx, input: FeedbackInput) {
  const self = await myEmployee(ctx);
  if (!self) throw Conflict('Your account has no employee record in this workspace, so it cannot give feedback.');

  const interview = await prisma.hrInterview.findFirst({ where: { tenantId: ctx.tenantId, id: input.interviewId } });
  if (!interview) throw NotFound('Interview');
  if (!interview.panelIds.includes(self.id)) throw Forbidden('Only the interview panel can leave feedback on it.');
  if (interview.status === 'CANCELLED') throw Conflict('That interview was cancelled.');
  if (input.rating < 1 || input.rating > 5) throw Conflict('Rate between 1 and 5.');

  const feedback = await prisma.hrInterviewFeedback.upsert({
    where: {
      tenantId_interviewId_interviewerId: {
        tenantId: ctx.tenantId,
        interviewId: interview.id,
        interviewerId: self.id,
      },
    },
    update: {
      rating: input.rating,
      recommendation: input.recommendation,
      scores: input.scores ?? {},
      notes: input.notes?.trim() || null,
    },
    create: {
      tenantId: ctx.tenantId,
      interviewId: interview.id,
      interviewerId: self.id,
      rating: input.rating,
      recommendation: input.recommendation,
      scores: input.scores ?? {},
      notes: input.notes?.trim() || null,
    },
  });

  // Once everyone on the panel has reported, the interview is done — nobody has
  // to remember to close it.
  const count = await prisma.hrInterviewFeedback.count({
    where: { tenantId: ctx.tenantId, interviewId: interview.id },
  });
  if (count >= interview.panelIds.length && interview.status === 'SCHEDULED') {
    await prisma.hrInterview.update({
      where: { tenantId: ctx.tenantId, id: interview.id },
      data: { status: 'COMPLETED' },
    });
  }

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_interview_feedback',
    recordId: feedback.id,
    metadata: {
      action: 'recruitment.feedback.submitted',
      interviewId: interview.id,
      recommendation: input.recommendation,
    },
  });
  return feedback;
}

// ── Offers ─────────────────────────────────────────────────────────────────

export interface OfferInput {
  candidateId: string;
  basic: number;
  housing?: number;
  transport?: number;
  otherAllowance?: number;
  joiningDate: Date;
  expiresAt?: Date;
  notes?: string;
}

/** A new offer is a new version; the previous one is superseded, not edited. */
export async function createOffer(ctx: Ctx, input: OfferInput) {
  requireRecruiter(ctx);
  if (!mayReadBands(ctx)) throw Forbidden('Your role does not allow setting offer compensation.');

  const candidate = await prisma.hrCandidate.findFirst({ where: { tenantId: ctx.tenantId, id: input.candidateId } });
  if (!candidate) throw NotFound('Candidate');
  if (TERMINAL.includes(candidate.stage)) throw Conflict(`That candidate is already ${candidate.stage.toLowerCase()}.`);
  if (input.basic <= 0) throw Conflict('Basic pay must be greater than zero.');
  if (toDay(input.joiningDate) < toDay(new Date())) throw Conflict('The joining date is in the past.');

  const actor = await myEmployee(ctx);
  const offer = await withTx(ctx.tenantId, async (tx) => {
    const previous = await tx.hrOffer.findFirst({
      where: { tenantId: ctx.tenantId, candidateId: candidate.id },
      orderBy: { version: 'desc' },
      select: { version: true, status: true, id: true },
    });
    if (previous?.status === 'ACCEPTED') throw Conflict('This candidate has already accepted an offer.');
    // A superseded offer must not stay outstanding, or two live offers exist.
    if (previous && ['SENT', 'PENDING_APPROVAL', 'APPROVED', 'DRAFT'].includes(previous.status)) {
      await tx.hrOffer.update({
        where: { tenantId: ctx.tenantId, id: previous.id },
        data: { status: 'WITHDRAWN', decisionNote: 'Superseded by a revised offer.' },
      });
    }

    return tx.hrOffer.create({
      data: {
        tenantId: ctx.tenantId,
        candidateId: candidate.id,
        version: (previous?.version ?? 0) + 1,
        basic: input.basic,
        housing: input.housing ?? 0,
        transport: input.transport ?? 0,
        otherAllowance: input.otherAllowance ?? 0,
        joiningDate: toDay(input.joiningDate),
        expiresAt: input.expiresAt ?? null,
        notes: input.notes?.trim() || null,
        createdById: actor?.id ?? null,
      },
    });
  });

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_offer',
    recordId: offer.id,
    metadata: { action: 'recruitment.offer.created', candidateId: candidate.id, version: offer.version },
  });
  return offer;
}

export async function decideOffer(ctx: Ctx, offerId: string, approve: boolean, note?: string) {
  if (!isHiringApprover(ctx)) throw Forbidden('Your role does not allow approving an offer.');
  const offer = await prisma.hrOffer.findFirst({ where: { tenantId: ctx.tenantId, id: offerId } });
  if (!offer) throw NotFound('Offer');
  if (!['DRAFT', 'PENDING_APPROVAL'].includes(offer.status)) throw Conflict('That offer has already been decided.');

  const actor = await myEmployee(ctx);
  const updated = await prisma.hrOffer.update({
    where: { tenantId: ctx.tenantId, id: offer.id },
    data: {
      status: approve ? 'APPROVED' : 'WITHDRAWN',
      approvedById: actor?.id ?? null,
      approvedAt: approve ? new Date() : null,
      decisionNote: note?.trim() || null,
    },
  });
  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_offer',
    recordId: offer.id,
    metadata: {
      action: approve ? 'recruitment.offer.approved' : 'recruitment.offer.withdrawn',
      version: offer.version,
    },
  });
  return updated;
}

/** Marks an approved offer as sent, and moves the candidate to the offer stage. */
export async function sendOffer(ctx: Ctx, offerId: string) {
  requireRecruiter(ctx);
  const offer = await prisma.hrOffer.findFirst({ where: { tenantId: ctx.tenantId, id: offerId } });
  if (!offer) throw NotFound('Offer');
  if (offer.status !== 'APPROVED') throw Conflict('An offer must be approved before it is sent.');

  const actor = await myEmployee(ctx);
  const updated = await withTx(ctx.tenantId, async (tx) => {
    const candidate = await tx.hrCandidate.findFirstOrThrow({
      where: { tenantId: ctx.tenantId, id: offer.candidateId },
    });
    if (candidate.stage !== 'OFFER') {
      await tx.hrCandidateStageEvent.create({
        data: {
          tenantId: ctx.tenantId,
          candidateId: candidate.id,
          fromStage: candidate.stage,
          toStage: 'OFFER',
          note: `Offer v${offer.version} sent`,
          changedById: actor?.id ?? null,
        },
      });
      await tx.hrCandidate.update({ where: { tenantId: ctx.tenantId, id: candidate.id }, data: { stage: 'OFFER' } });
    }
    return tx.hrOffer.update({ where: { tenantId: ctx.tenantId, id: offer.id }, data: { status: 'SENT' } });
  });

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_offer',
    recordId: offer.id,
    metadata: { action: 'recruitment.offer.sent', version: offer.version },
  });
  return updated;
}

export async function recordOfferResponse(ctx: Ctx, offerId: string, accepted: boolean, note?: string) {
  requireRecruiter(ctx);
  const offer = await prisma.hrOffer.findFirst({ where: { tenantId: ctx.tenantId, id: offerId } });
  if (!offer) throw NotFound('Offer');
  if (offer.status !== 'SENT') throw Conflict('Only a sent offer can have a response recorded.');
  if (offer.expiresAt && offer.expiresAt < new Date() && accepted)
    throw Conflict('That offer has expired. Issue a revised one rather than back-dating an acceptance.');

  const actor = await myEmployee(ctx);
  const updated = await withTx(ctx.tenantId, async (tx) => {
    if (!accepted) {
      const candidate = await tx.hrCandidate.findFirstOrThrow({
        where: { tenantId: ctx.tenantId, id: offer.candidateId },
      });
      await tx.hrCandidateStageEvent.create({
        data: {
          tenantId: ctx.tenantId,
          candidateId: candidate.id,
          fromStage: candidate.stage,
          toStage: 'WITHDRAWN',
          note: note?.trim() || 'Offer declined',
          changedById: actor?.id ?? null,
        },
      });
      await tx.hrCandidate.update({
        where: { tenantId: ctx.tenantId, id: candidate.id },
        data: { stage: 'WITHDRAWN' },
      });
    }
    return tx.hrOffer.update({
      where: { tenantId: ctx.tenantId, id: offer.id },
      data: { status: accepted ? 'ACCEPTED' : 'DECLINED', respondedAt: new Date(), decisionNote: note?.trim() || null },
    });
  });

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_offer',
    recordId: offer.id,
    metadata: {
      action: accepted ? 'recruitment.offer.accepted' : 'recruitment.offer.declined',
      version: offer.version,
    },
  });
  const responded = await prisma.hrCandidate.findFirst({
    where: { tenantId: ctx.tenantId, id: offer.candidateId },
    select: { fullName: true },
  });
  await notifyOfferResponded(ctx, {
    accepted,
    candidateName: responded?.fullName ?? 'A candidate',
    candidateId: offer.candidateId,
  });
  return updated;
}

// ── The hire (§109) ────────────────────────────────────────────────────────

export interface HireInput {
  candidateId: string;
  employeeNumber: string;
  roleKey?: string;
  departmentId?: string;
  designation?: string;
}

/**
 * Turn an accepted offer into a person who will exist in HR.
 *
 * This deliberately issues an *invitation* rather than creating an account
 * outright: the employee record is created when the invitation is accepted, by
 * which point the new joiner has set a password only they have seen. That is the
 * same rule the manual "add employee" path follows, and it is why onboarding is
 * a second, explicit step — see `startOnboardingForCandidate`.
 *
 * What makes it a conversion rather than a status flag: the invitation carries
 * the candidate id and the agreed joining date, so the employee record that
 * appears on acceptance points back at the application (§109) and dates from the
 * offer rather than from whenever the person happened to click the link.
 */
export async function hireCandidate(ctx: Ctx, input: HireInput) {
  requireRecruiter(ctx);
  const candidate = await prisma.hrCandidate.findFirst({
    where: { tenantId: ctx.tenantId, id: input.candidateId },
    include: { requisition: true, offers: { orderBy: { version: 'desc' }, take: 1 } },
  });
  if (!candidate) throw NotFound('Candidate');
  if (candidate.stage === 'HIRED') throw Conflict('That candidate has already been hired.');

  const offer = candidate.offers[0];
  // The whole control: a hire needs an offer somebody accepted, not a stage
  // somebody dragged.
  if (!offer || offer.status !== 'ACCEPTED')
    throw Conflict('Record the candidate’s acceptance of an offer before completing the hire.');

  const role = await prisma.role.findFirst({
    where: { tenantId: ctx.tenantId, key: input.roleKey ?? 'employee' },
  });
  if (!role) throw NotFound('Role');

  // inviteUser applies the seat limit and the role-rank guard, so a recruiter
  // cannot hire somebody into a role they could not administer themselves.
  const invitation = await inviteUser(ctx, {
    email: candidate.email,
    fullName: candidate.fullName,
    roleId: role.id,
    employeeNumber: input.employeeNumber,
    jobTitle: input.designation ?? candidate.requisition.title,
    departmentId: input.departmentId ?? candidate.requisition.departmentId ?? undefined,
    candidateId: candidate.id,
    joiningDate: offer.joiningDate,
  });

  const actor = await myEmployee(ctx);
  const updated = await withTx(ctx.tenantId, async (tx) => {
    await tx.hrCandidateStageEvent.create({
      data: {
        tenantId: ctx.tenantId,
        candidateId: candidate.id,
        fromStage: candidate.stage,
        toStage: 'HIRED',
        note: `Invitation issued for ${candidate.email}`,
        changedById: actor?.id ?? null,
      },
    });
    return tx.hrCandidate.update({
      where: { tenantId: ctx.tenantId, id: candidate.id },
      data: { stage: 'HIRED', invitationId: (invitation as { id?: string }).id ?? null },
    });
  });

  await audit(ctx, {
    event: 'RECORD_UPDATED',
    objectType: 'hr_candidate',
    recordId: candidate.id,
    metadata: {
      action: 'recruitment.candidate.hired',
      requisitionId: candidate.requisitionId,
      joiningDate: offer.joiningDate.toISOString().slice(0, 10),
    },
  });
  return updated;
}

/**
 * Start the onboarding checklist for a hire whose invitation has been accepted.
 *
 * Separate from `hireCandidate` because the employee record does not exist until
 * acceptance, and acceptance is an unauthenticated request with no HR actor to
 * attribute a checklist to. So this is the one manual step in the §109 chain:
 * the ATS surfaces it as soon as the employee row appears.
 */
export async function startOnboardingForCandidate(ctx: Ctx, candidateId: string) {
  const employee = await prisma.employeeProfile.findFirst({
    where: { tenantId: ctx.tenantId, hiredFromCandidateId: candidateId, deletedAt: null },
    select: { id: true },
  });
  if (!employee)
    throw Conflict('This hire has not accepted their invitation yet, so there is no employee record to onboard.');
  return startOnboarding(ctx, employee.id);
}

// ── Pipeline reporting ─────────────────────────────────────────────────────

export async function pipelineSummary(ctx: Ctx) {
  if (!mayReadRecruitment(ctx)) throw Forbidden('Your role does not allow reading recruitment.');
  const [byStage, openRequisitions, hires] = await Promise.all([
    prisma.hrCandidate.groupBy({ by: ['stage'], where: { tenantId: ctx.tenantId }, _count: { _all: true } }),
    prisma.hrRequisition.count({ where: { tenantId: ctx.tenantId, status: 'OPEN' } }),
    prisma.hrCandidateStageEvent.findMany({
      where: { tenantId: ctx.tenantId, toStage: 'HIRED' },
      select: { candidateId: true, createdAt: true },
      take: 500,
    }),
  ]);

  // Time to hire, measured from the application to the hire event.
  const applied = hires.length
    ? await prisma.hrCandidate.findMany({
        where: { tenantId: ctx.tenantId, id: { in: hires.map((hire) => hire.candidateId) } },
        select: { id: true, createdAt: true },
      })
    : [];
  const appliedAt = new Map(applied.map((row) => [row.id, row.createdAt]));
  const spans = hires
    .map((hire) => {
      const from = appliedAt.get(hire.candidateId);
      return from ? (hire.createdAt.getTime() - from.getTime()) / 86_400_000 : null;
    })
    .filter((value): value is number => value !== null);

  return {
    openRequisitions,
    byStage: Object.fromEntries(byStage.map((row) => [row.stage, row._count._all])),
    hires: hires.length,
    averageDaysToHire: spans.length ? Number((spans.reduce((a, b) => a + b, 0) / spans.length).toFixed(1)) : null,
  };
}
