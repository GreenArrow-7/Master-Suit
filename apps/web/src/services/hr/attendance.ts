/**
 * Server-side attendance validation and the face check-in flow.
 *
 * Ported from the original HRMS `app/services/location_rules.py` and
 * `app/api/attendance.py`. The browser reports raw coordinates and camera
 * frames; every decision is made here. Each rejection carries a machine code and
 * a message a human can act on, and every attempt — accepted or rejected — is
 * recorded with the location evidence the server measured, never the client's
 * claim about where it was standing.
 */
import { prisma } from '@/lib/db';
import { AppError, Conflict, Forbidden, NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import type { Ctx } from '@/lib/security/rbac';
import { haversineM, insideGeofence, toDay, withinTimeWindow, zonedParts } from './rules';
import {
  analyse,
  bestMatch,
  consumeChallenge,
  engineHealth,
  enrolmentSpread,
  EngineUnavailable,
  issueChallenge,
  toBytes,
  verifyLiveness,
  type Detection,
} from './face';
import { isHrAdmin, myEmployee, requireEmployee } from './leave';
import { getHrPolicy, type HrPolicy } from './settings';
import { storeCapture } from './captureVault';
import { EMPLOYEE_WITH_PERSON } from './publicSelect';

export type PunchType = 'CHECK_IN' | 'CHECK_OUT';
export type PunchResult =
  | 'ACCEPTED'
  | 'FLAGGED_REVIEW'
  | 'REJECTED_FACE'
  | 'REJECTED_LIVENESS'
  | 'REJECTED_GEOFENCE'
  | 'REJECTED_ACCURACY'
  | 'REJECTED_DUPLICATE'
  | 'REJECTED_STALE_SYNC';

const MAX_FRAME_BYTES = 3 * 1024 * 1024;

/**
 * The longest a single shift may run before a check-out stops being treated as
 * closing it. Covers a night shift plus a generous overrun; beyond it the
 * check-in was almost certainly never closed and should not be back-filled.
 */
const MAX_SHIFT_HOURS = 18;

/** A refusal that still gets written to the punch log, with its evidence. */
export class PunchRejected extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly result: PunchResult,
    readonly location?: {
      id: string;
      name: string;
      latitude: number;
      longitude: number;
      radiusMeters: number;
      maxAccuracyMeters: number;
    } | null,
    readonly distanceM?: number | null,
  ) {
    super(message);
  }
}

type Assignment = Awaited<ReturnType<typeof loadAssignments>>[number];

async function loadAssignments(ctx: Ctx, employeeId: string) {
  return prisma.hrEmployeeLocationAssignment.findMany({
    where: { tenantId: ctx.tenantId, employeeId },
    include: { location: true },
  });
}

async function workspaceTimezone(ctx: Ctx) {
  const tenant = await prisma.tenant.findFirst({ where: { id: ctx.tenantId }, select: { timezone: true } });
  return tenant?.timezone || 'Asia/Dubai';
}

const withinDates = (from: Date | null, to: Date | null, today: Date) =>
  (!from || toDay(from) <= today) && (!to || toDay(to) >= today);

/**
 * Assignments that are valid for this action, right now, in the workspace's own
 * timezone. Anything outside its dates, days or hours is simply not a candidate
 * — the employee is told they have no active assignment rather than being
 * measured against a location they may not use.
 */
export function candidateAssignments(assignments: Assignment[], action: PunchType, at: Date, timeZone: string) {
  const today = toDay(at);
  const { weekday, minutes } = zonedParts(at, timeZone);

  return assignments.filter((assignment) => {
    if (assignment.status !== 'ACTIVE') return false;
    if (!withinDates(assignment.effectiveFrom, assignment.effectiveTo, today)) return false;
    if (action === 'CHECK_IN' && !assignment.checkInAllowed) return false;
    if (action === 'CHECK_OUT' && !assignment.checkOutAllowed) return false;

    const location = assignment.location;
    if (location.status !== 'ACTIVE') return false;
    if (!withinDates(location.effectiveFrom, location.effectiveTo, today)) return false;

    const days = assignment.allowedDays.length ? assignment.allowedDays : location.workingDays;
    if (days.length && !days.includes(weekday)) return false;

    return withinTimeWindow(
      assignment.allowedStartTime ?? location.openingTime,
      assignment.allowedEndTime ?? location.closingTime,
      minutes,
    );
  });
}

/** The latest accepted punch, when it is a check-in with no check-out after it. */
export async function openCheckIn(ctx: Ctx, employeeId: string) {
  const last = await prisma.hrAttendancePunch.findFirst({
    where: { tenantId: ctx.tenantId, employeeId, result: 'ACCEPTED' },
    orderBy: { serverTime: 'desc' },
  });
  return last?.punchType === 'CHECK_IN' ? last : null;
}

export interface PunchContext {
  assignment: Assignment;
  distanceM: number;
  inside: boolean;
}

/**
 * Everything that decides whether a punch may be recorded, except the face.
 *
 * `enforceGeofence` is false for the face flow: the liveness nonce must be
 * consumed before the geofence verdict is returned, so a payload rejected for
 * being outside the fence can never be replayed from inside it.
 */
export async function validatePunch(
  ctx: Ctx,
  employee: { id: string; employmentStatus: string },
  action: PunchType,
  position: { latitude: number; longitude: number; gpsAccuracyM: number },
  enforceGeofence = true,
  policy?: HrPolicy,
): Promise<PunchContext> {
  const effective = policy ?? (await getHrPolicy(ctx));
  if (!['ACTIVE', 'NOTICE', 'ONBOARDING'].includes(employee.employmentStatus)) {
    throw new PunchRejected('EMPLOYMENT_INACTIVE', 'You have no active employment record.', 'REJECTED_DUPLICATE');
  }

  const open = await openCheckIn(ctx, employee.id);
  if (action === 'CHECK_IN' && open) {
    throw new PunchRejected(
      'ALREADY_CHECKED_IN',
      'You already have an open check-in. Check out first.',
      'REJECTED_DUPLICATE',
    );
  }
  if (action === 'CHECK_OUT' && !open) {
    throw new PunchRejected(
      'NO_OPEN_CHECKIN',
      'There is no open check-in to close. If you forgot to check in, ask HR to record it.',
      'REJECTED_DUPLICATE',
    );
  }

  const [assignments, timeZone] = await Promise.all([loadAssignments(ctx, employee.id), workspaceTimezone(ctx)]);
  let candidates = candidateAssignments(assignments, action, new Date(), timeZone);
  if (!candidates.length) {
    throw new PunchRejected(
      'NO_ACTIVE_ASSIGNMENT',
      'You have no active work-location assignment valid right now. Contact HR.',
      'REJECTED_GEOFENCE',
    );
  }

  // Check-out rules narrow the candidates before any distance is measured.
  if (action === 'CHECK_OUT' && open?.locationId) {
    const checkedInAt = candidates.find((candidate) => candidate.locationId === open.locationId);
    const rule = checkedInAt?.checkoutRule ?? 'SAME_LOCATION';
    if (rule === 'EXCEPTION_ONLY') {
      throw new PunchRejected(
        'CHECKOUT_REQUIRES_EXCEPTION',
        'Check-out from this assignment requires an approved attendance exception.',
        'REJECTED_GEOFENCE',
      );
    }
    if (rule === 'SAME_LOCATION') {
      const same = candidates.filter((candidate) => candidate.locationId === open.locationId);
      if (!same.length) {
        throw new PunchRejected(
          'CHECKOUT_WRONG_LOCATION',
          'Check-out must happen at the same location you checked in from.',
          'REJECTED_GEOFENCE',
        );
      }
      candidates = same;
    }
  }

  const measured = candidates
    .map((assignment) => ({
      assignment,
      distanceM: haversineM(
        position.latitude,
        position.longitude,
        assignment.location.latitude,
        assignment.location.longitude,
      ),
    }))
    .sort((a, b) => a.distanceM - b.distanceM);

  const nearest = measured[0]!;
  const maxAccuracy = nearest.assignment.location.maxAccuracyMeters || effective.maxGpsAccuracyM;
  if (position.gpsAccuracyM && position.gpsAccuracyM > maxAccuracy) {
    throw new PunchRejected(
      'LOCATION_ACCURACY_TOO_LOW',
      `Your GPS is accurate to about ±${Math.round(position.gpsAccuracyM)} m and this location requires ±${maxAccuracy} m or better. Move to an open area, away from glass and covered parking, and try again.`,
      'REJECTED_ACCURACY',
      nearest.assignment.location,
      nearest.distanceM,
    );
  }

  const within = measured.find(({ assignment, distanceM }) =>
    insideGeofence(distanceM, assignment.location.radiusMeters),
  );

  if (!within) {
    if (enforceGeofence) throw geofenceRejection(nearest.assignment.location, nearest.distanceM);
    return { assignment: nearest.assignment, distanceM: nearest.distanceM, inside: false };
  }
  return { assignment: within.assignment, distanceM: within.distanceM, inside: true };
}

export function geofenceRejection(
  location: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    maxAccuracyMeters: number;
  },
  distanceM: number,
) {
  return new PunchRejected(
    'OUTSIDE_APPROVED_LOCATION',
    `You are ${Math.round(distanceM)} metres from ${location.name}. The permitted radius is ${location.radiusMeters} metres. Move inside the approved location and try again.`,
    'REJECTED_GEOFENCE',
    location,
    distanceM,
  );
}

// ── Preflight ──────────────────────────────────────────────────────────────

/**
 * Read-only. Tells the employee where they stand *before* they punch: which
 * assigned location is nearest, the server-measured distance, the permitted
 * radius and whether their GPS fix is good enough.
 *
 * This writes nothing and grants nothing. validatePunch re-derives every one of
 * these values at punch time, so a stale or forged preflight lets nobody in.
 */
export async function preflight(
  ctx: Ctx,
  action: PunchType,
  position: { latitude: number; longitude: number; gpsAccuracyM: number },
) {
  const employee = await myEmployee(ctx);
  if (!employee) throw NotFound('Employee');

  const [assignments, timeZone, open, policy] = await Promise.all([
    loadAssignments(ctx, employee.id),
    workspaceTimezone(ctx),
    openCheckIn(ctx, employee.id),
    getHrPolicy(ctx),
  ]);
  let candidates = candidateAssignments(assignments, action, new Date(), timeZone);

  if (!candidates.length) {
    return {
      ok: false,
      code: 'NO_ACTIVE_ASSIGNMENT',
      message: 'You have no active work-location assignment for this action right now. Contact HR.',
      candidates: [],
    };
  }
  if (action === 'CHECK_OUT' && open?.locationId) {
    const checkedInAt = candidates.find((candidate) => candidate.locationId === open.locationId);
    if ((checkedInAt?.checkoutRule ?? 'SAME_LOCATION') === 'SAME_LOCATION' && checkedInAt) candidates = [checkedInAt];
  }

  const rows = candidates
    .map((assignment) => {
      const distanceM = haversineM(
        position.latitude,
        position.longitude,
        assignment.location.latitude,
        assignment.location.longitude,
      );
      const maxAccuracyM = assignment.location.maxAccuracyMeters || policy.maxGpsAccuracyM;
      return {
        assignmentId: assignment.id,
        locationId: assignment.locationId,
        name: assignment.location.name,
        distanceM: Math.round(distanceM * 10) / 10,
        radiusM: assignment.location.radiusMeters,
        inside: insideGeofence(distanceM, assignment.location.radiusMeters),
        maxAccuracyM,
        accuracyOk: position.gpsAccuracyM <= maxAccuracyM,
        checkoutRule: assignment.checkoutRule,
      };
    })
    .sort((a, b) => a.distanceM - b.distanceM);

  const nearest = rows[0]!;
  if (!nearest.accuracyOk) {
    return {
      ok: false,
      code: 'LOCATION_ACCURACY_TOO_LOW',
      message: `Your GPS is accurate to about ±${Math.round(position.gpsAccuracyM)} m. This location requires ${nearest.maxAccuracyM} m or better. Move to an open area and retry.`,
      candidates: rows,
    };
  }
  const ready = rows.find((row) => row.inside);
  if (!ready) {
    return {
      ok: false,
      code: 'OUTSIDE_APPROVED_LOCATION',
      message: `You are ${Math.round(nearest.distanceM)} metres away from ${nearest.name}. The permitted radius is ${nearest.radiusM} metres.`,
      candidates: rows,
    };
  }
  return {
    ok: true,
    code: 'READY',
    message: `Inside ${ready.name} — ${Math.round(ready.distanceM)} m from centre, radius ${ready.radiusM} m.`,
    candidates: rows,
  };
}

// ── Consent and enrolment ──────────────────────────────────────────────────

export async function activeConsent(ctx: Ctx, employeeId: string) {
  return prisma.biometricConsent.findFirst({
    where: { tenantId: ctx.tenantId, employeeId, grantedAt: { not: null }, withdrawnAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

/** Consent is the employee's own to give. Nobody grants it on their behalf. */
export async function grantConsent(ctx: Ctx, policyVersion = 'PDPL-2026-01') {
  const employee = await myEmployee(ctx);
  if (!employee) throw NotFound('Employee');
  const existing = await activeConsent(ctx, employee.id);
  if (existing) return existing;

  const consent = await prisma.biometricConsent.create({
    data: { tenantId: ctx.tenantId, employeeId: employee.id, grantedAt: new Date(), policyVersion },
  });
  await audit(ctx, {
    event: 'CONSENT_RECORDED',
    objectType: 'biometric_consent',
    recordId: consent.id,
    metadata: { action: 'biometric.consent.granted', policyVersion },
  });
  return consent;
}

/**
 * Withdrawal deletes the templates immediately — keeping biometrics after
 * consent is withdrawn has no lawful basis, and a withdrawal that leaves the
 * data in place is not a withdrawal.
 */
export async function withdrawConsent(ctx: Ctx, employeeId?: string) {
  const self = await myEmployee(ctx);
  const targetId = employeeId ?? self?.id;
  if (!targetId) throw NotFound('Employee');
  if (targetId !== self?.id && !isHrAdmin(ctx)) throw Forbidden('You can only withdraw your own biometric consent.');

  const [consents, templates] = await Promise.all([
    prisma.biometricConsent.updateMany({
      where: { tenantId: ctx.tenantId, employeeId: targetId, withdrawnAt: null },
      data: { withdrawnAt: new Date() },
    }),
    prisma.hrFaceTemplate.deleteMany({ where: { tenantId: ctx.tenantId, employeeId: targetId } }),
  ]);

  await audit(ctx, {
    event: 'CONSENT_WITHDRAWN',
    objectType: 'biometric_consent',
    recordId: targetId,
    metadata: { action: 'biometric.consent.withdrawn', templatesDeleted: templates.count },
  });
  return { consentsWithdrawn: consents.count, templatesDeleted: templates.count };
}

/** HR-only and done in person. Stores embeddings; raw images are never persisted. */
export async function enrolFace(ctx: Ctx, employeeId: string, frames: string[]) {
  if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can enrol a face.');
  const employee = await requireEmployee(ctx, employeeId);

  if (!(await activeConsent(ctx, employee.id))) {
    throw Conflict('Record written biometric consent before enrolling this employee.');
  }
  const policy = await getHrPolicy(ctx);
  if (frames.length < policy.faceSamplesRequired) {
    throw Conflict(`Capture at least ${policy.faceSamplesRequired} samples.`);
  }
  assertFrameSizes(frames);

  const detections = await analyse(frames, policy);
  const failed = detections.find((detection) => !detection.ok);
  if (failed) throw Conflict(failed.error ?? 'One of the samples could not be used.');

  const embeddings = detections.map((detection) => detection.embedding!);
  const spread = enrolmentSpread(embeddings);
  if (spread < policy.faceEnrolmentMinSpread) {
    throw Conflict(
      'The samples are too similar. Capture different angles: straight on, slight left, slight right, slight up.',
    );
  }

  await prisma.hrFaceTemplate.deleteMany({ where: { tenantId: ctx.tenantId, employeeId: employee.id } });
  await prisma.hrFaceTemplate.createMany({
    data: embeddings.map((embedding) => ({
      tenantId: ctx.tenantId,
      employeeId: employee.id,
      embedding: toBytes(embedding),
      dim: embedding.length,
      modelVersion: 'buffalo_l',
    })),
  });

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_face_template',
    recordId: employee.id,
    metadata: { action: 'face.enrolled', samples: embeddings.length, spread: Math.round(spread * 10_000) / 10_000 },
  });
  return { employeeId: employee.id, samples: embeddings.length, sampleSpread: Math.round(spread * 10_000) / 10_000 };
}

/**
 * Wipes an employee's face templates without touching their consent — the
 * remedy for a bad enrolment, a changed appearance, or a suspected misuse.
 *
 * Deliberately separate from consent withdrawal. Withdrawal is the employee's
 * decision and ends the lawful basis for holding biometrics at all; a reset is
 * HR's decision and only says the samples on file are no longer good. Both
 * delete the templates, but only one of them may be done on somebody's behalf,
 * so conflating them would let HR record a withdrawal the employee never made.
 *
 * The reason is required and recorded: an administrator who can silently erase
 * the evidence of who checked in can erase the evidence of their own reason for
 * doing it. Check-in stops working the moment this returns, because
 * `requestChallenge` refuses an employee with fewer templates than the policy
 * requires — there is no separate flag to keep in step.
 */
export async function resetFaceEnrolment(ctx: Ctx, employeeId: string, reason: string) {
  if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can reset a face enrolment.');
  const trimmed = reason.trim();
  if (trimmed.length < 5) throw Conflict('Give a reason for resetting this enrolment.');
  const employee = await requireEmployee(ctx, employeeId);

  const removed = await prisma.hrFaceTemplate.deleteMany({
    where: { tenantId: ctx.tenantId, employeeId: employee.id },
  });

  await audit(ctx, {
    event: 'RECORD_DELETED',
    objectType: 'hr_face_template',
    recordId: employee.id,
    metadata: { action: 'face.enrolment.reset', templatesDeleted: removed.count, reason: trimmed },
  });
  return { employeeId: employee.id, templatesDeleted: removed.count, reason: trimmed };
}

// ── Challenge ──────────────────────────────────────────────────────────────

export async function requestChallenge(ctx: Ctx) {
  const employee = await myEmployee(ctx);
  if (!employee) throw NotFound('Employee');
  if (!(await activeConsent(ctx, employee.id)))
    throw Forbidden('Record your biometric consent before using face check-in.');

  const policy = await getHrPolicy(ctx);
  const enrolled = await prisma.hrFaceTemplate.count({ where: { tenantId: ctx.tenantId, employeeId: employee.id } });
  if (enrolled < policy.faceSamplesRequired) throw Conflict('Finish face enrolment with HR before checking in.');

  const health = await engineHealth();
  if (!health.ready) throw EngineUnavailable(health.detail);

  return issueChallenge(ctx.tenantId, employee.id, policy.challengeTtlSeconds);
}

// ── Punch ──────────────────────────────────────────────────────────────────

export interface PunchInput {
  punchType: PunchType;
  nonce: string;
  frames: string[];
  latitude: number;
  longitude: number;
  gpsAccuracyM: number;
  deviceFingerprint: string;
  mockLocationFlag?: boolean;
  clientTime?: Date;
  clientPunchUid?: string;
  syncedOffline?: boolean;
}

function assertFrameSizes(frames: string[]) {
  for (const frame of frames) {
    const payload = frame.includes(',') ? frame.slice(frame.indexOf(',') + 1) : frame;
    // base64 inflates by 4/3; check before shipping megabytes to the sidecar.
    if ((payload.length * 3) / 4 > MAX_FRAME_BYTES) {
      throw new AppError(413, 'frame-too-large', 'Camera frames are too large. Lower the capture quality.');
    }
  }
}

async function record(
  ctx: Ctx,
  employeeId: string,
  input: PunchInput,
  result: PunchResult,
  detail: {
    rejectCode?: string | null;
    rejectReason?: string | null;
    faceScore?: number | null;
    livenessScore?: number | null;
    distanceM?: number | null;
    location?: PunchRejected['location'];
  },
) {
  try {
    return await createPunch();
  } catch (error) {
    // A device that fires the same queued punch twice at once loses the race on
    // the (tenantId, employeeId, clientPunchUid) unique index. That is the
    // deduplication working, not a server fault — return the row that won.
    if (isUniqueViolation(error) && input.clientPunchUid) {
      const winner = await findByClientUid(ctx, employeeId, input.clientPunchUid);
      if (winner) return winner;
    }
    throw error;
  }

  function createPunch() {
    return prisma.hrAttendancePunch.create({
      data: {
        tenantId: ctx.tenantId,
        employeeId,
        punchType: input.punchType,
        result,
        method: 'face',
        clientTime: input.clientTime ?? null,
        latitude: input.latitude,
        longitude: input.longitude,
        gpsAccuracyM: input.gpsAccuracyM,
        distanceM: detail.distanceM ?? null,
        faceScore: detail.faceScore ?? null,
        livenessScore: detail.livenessScore ?? null,
        deviceFingerprint: input.deviceFingerprint,
        mockLocationFlag: input.mockLocationFlag ?? false,
        rejectCode: detail.rejectCode ?? null,
        rejectReason: detail.rejectReason ?? null,
        syncedOffline: input.syncedOffline ?? false,
        clientPunchUid: input.clientPunchUid ?? null,
        requestId: ctx.requestId,
        serverIp: ctx.ip,
        locationId: detail.location?.id ?? null,
        locLatitude: detail.location?.latitude ?? null,
        locLongitude: detail.location?.longitude ?? null,
        locRadiusM: detail.location?.radiusMeters ?? null,
      },
    });
  }
}

const findByClientUid = (ctx: Ctx, employeeId: string, clientPunchUid: string) =>
  prisma.hrAttendancePunch.findFirst({ where: { tenantId: ctx.tenantId, employeeId, clientPunchUid } });

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

/** Keeps the presented frame as encrypted evidence, for accepted and rejected punches alike. */
async function keepCapture(ctx: Ctx, employeeId: string, punchId: string, frames: string[], when: Date) {
  const last = frames[frames.length - 1];
  if (!last) return;
  const payload = Buffer.from(last.includes(',') ? last.slice(last.indexOf(',') + 1) : last, 'base64');
  const capturePath = await storeCapture(ctx.tenantId, employeeId, punchId, payload, when);
  if (capturePath) {
    await prisma.hrAttendancePunch.update({ where: { tenantId: ctx.tenantId, id: punchId }, data: { capturePath } });
  }
}

/**
 * The whole face check-in. Order matters and is deliberate:
 *
 *   1. idempotent replay of an offline punch short-circuits before anything else
 *   2. cheap refusals (stale sync, minimum interval, sequence, GPS accuracy)
 *      run *before* the nonce is consumed, so a weak fix or a too-soon retry
 *      does not burn the challenge and force the whole capture again
 *   3. the nonce is spent once we actually look at the frames
 *   4. liveness, then face match, then the geofence verdict
 */
export async function punch(ctx: Ctx, input: PunchInput) {
  const employee = await myEmployee(ctx);
  if (!employee) throw NotFound('Employee');
  if (!(await activeConsent(ctx, employee.id)))
    throw Forbidden('Record your biometric consent before using face check-in.');
  assertFrameSizes(input.frames);
  const policy = await getHrPolicy(ctx);

  // 1. The same queued punch synced twice is one row, not two.
  if (input.clientPunchUid) {
    const existing = await findByClientUid(ctx, employee.id, input.clientPunchUid);
    if (existing) {
      return {
        result: existing.result,
        message: 'Already recorded.',
        serverTime: existing.serverTime,
        distanceM: existing.distanceM,
      };
    }
  }

  // 2. A queued punch from last week must not land as today's attendance.
  if (input.syncedOffline && input.clientTime) {
    const ageHours = (Date.now() - input.clientTime.getTime()) / 3_600_000;
    if (ageHours > policy.maxOfflineSyncHours) {
      const row = await record(ctx, employee.id, input, 'REJECTED_STALE_SYNC', {
        rejectCode: 'STALE_SYNC',
        rejectReason: `Offline punch ${Math.round(ageHours)}h old`,
      });
      return {
        result: row.result,
        message: 'This queued check-in is too old to sync. Ask HR to record it manually.',
        serverTime: row.serverTime,
        distanceM: null,
      };
    }
  }

  const recent = await prisma.hrAttendancePunch.findFirst({
    where: {
      tenantId: ctx.tenantId,
      employeeId: employee.id,
      result: 'ACCEPTED',
      serverTime: { gte: new Date(Date.now() - policy.minPunchIntervalSeconds * 1000) },
    },
  });
  if (recent) {
    const row = await record(ctx, employee.id, input, 'REJECTED_DUPLICATE', {
      rejectCode: 'MIN_INTERVAL',
      rejectReason: 'Within minimum interval',
    });
    return {
      result: row.result,
      message: 'You just checked in. Wait a moment and retry.',
      serverTime: row.serverTime,
      distanceM: null,
    };
  }

  let context: PunchContext;
  try {
    context = await validatePunch(ctx, employee, input.punchType, input, false, policy);
  } catch (error) {
    if (!(error instanceof PunchRejected)) throw error;
    const row = await record(ctx, employee.id, input, error.result, {
      rejectCode: error.code,
      rejectReason: error.message,
      distanceM: error.distanceM,
      location: error.location,
    });
    return {
      result: row.result,
      message: error.message,
      serverTime: row.serverTime,
      distanceM: error.distanceM ?? null,
    };
  }

  // 3. Spend the nonce. From here a replayed payload is worthless.
  const direction = await consumeChallenge(ctx.tenantId, employee.id, input.nonce);

  // A resent still image is caught before any model runs.
  if (new Set(input.frames).size < input.frames.length) {
    const row = await record(ctx, employee.id, input, 'REJECTED_LIVENESS', {
      rejectCode: 'IDENTICAL_FRAMES',
      rejectReason: 'Identical frames',
    });
    await keepCapture(ctx, employee.id, row.id, input.frames, row.serverTime);
    return {
      result: row.result,
      message: 'Identical frames — send live camera frames.',
      serverTime: row.serverTime,
      distanceM: null,
    };
  }

  // An engine outage is an operational fault, not the employee's doing: this
  // throws 503 and writes no punch row, so it never reads as a failed attempt
  // by them. Failing closed is the point — there is no fallback that lets a
  // punch through unverified.
  const detections: Detection[] = await analyse(input.frames, policy);

  const liveness = verifyLiveness(detections, direction, policy);
  if (!liveness.passed) {
    const row = await record(ctx, employee.id, input, 'REJECTED_LIVENESS', {
      rejectCode: 'LIVENESS',
      rejectReason: liveness.reason,
      livenessScore: liveness.score,
    });
    await keepCapture(ctx, employee.id, row.id, input.frames, row.serverTime);
    return { result: row.result, message: liveness.reason, serverTime: row.serverTime, distanceM: null };
  }

  const templates = await prisma.hrFaceTemplate.findMany({
    where: { tenantId: ctx.tenantId, employeeId: employee.id },
    select: { embedding: true },
  });
  if (templates.length < policy.faceSamplesRequired)
    throw Conflict('Finish face enrolment with HR before checking in.');

  const score = bestMatch(
    liveness.embedding!,
    templates.map((template) => template.embedding),
  );
  if (score < policy.faceMatchThreshold) {
    const row = await record(ctx, employee.id, input, 'REJECTED_FACE', {
      rejectCode: 'FACE_MISMATCH',
      rejectReason: `Score ${score.toFixed(3)}`,
      faceScore: score,
      livenessScore: liveness.score,
    });
    await keepCapture(ctx, employee.id, row.id, input.frames, row.serverTime);
    return {
      result: row.result,
      message: 'We could not confirm it is you. Try again or contact HR.',
      serverTime: row.serverTime,
      distanceM: null,
    };
  }

  // 4. Geofence last, now that the nonce is spent.
  if (!context.inside) {
    const rejection = geofenceRejection(context.assignment.location, context.distanceM);
    const row = await record(ctx, employee.id, input, rejection.result, {
      rejectCode: rejection.code,
      rejectReason: rejection.message,
      faceScore: score,
      livenessScore: liveness.score,
      distanceM: context.distanceM,
      location: context.assignment.location,
    });
    await keepCapture(ctx, employee.id, row.id, input.frames, row.serverTime);
    return { result: row.result, message: rejection.message, serverTime: row.serverTime, distanceM: context.distanceM };
  }

  const result: PunchResult = input.mockLocationFlag ? 'FLAGGED_REVIEW' : 'ACCEPTED';
  const row = await record(ctx, employee.id, input, result, {
    rejectReason: input.mockLocationFlag ? 'Mock location reported by device' : null,
    faceScore: score,
    livenessScore: liveness.score,
    distanceM: context.distanceM,
    location: context.assignment.location,
  });
  await keepCapture(ctx, employee.id, row.id, input.frames, row.serverTime);
  await upsertDay(ctx, employee.id, row);

  await audit(ctx, {
    event: 'RECORD_CREATED',
    objectType: 'hr_attendance_punch',
    recordId: row.id,
    metadata: {
      action: `attendance.${input.punchType.toLowerCase()}`,
      location: context.assignment.location.name,
      faceScore: Math.round(score * 1000) / 1000,
      distanceM: Math.round(context.distanceM),
      radiusM: context.assignment.location.radiusMeters,
    },
  });

  let message = input.punchType === 'CHECK_IN' ? 'Checked in.' : 'Checked out.';
  if (result === 'FLAGGED_REVIEW') message += ' Sent to HR for review — your device reported a simulated location.';
  return { result, message, serverTime: row.serverTime, distanceM: context.distanceM };
}

/** The day roll-up the attendance screens read. */
export async function upsertDay(
  ctx: Ctx,
  employeeId: string,
  punchRow: { punchType: PunchType; serverTime: Date; locationId: string | null },
) {
  const workDate = toDay(punchRow.serverTime);

  if (punchRow.punchType === 'CHECK_IN') {
    await prisma.hrAttendanceRecord.upsert({
      where: { tenantId_employeeId_workDate: { tenantId: ctx.tenantId, employeeId, workDate } },
      update: { checkInAt: punchRow.serverTime, locationId: punchRow.locationId, status: 'PRESENT' },
      create: {
        tenantId: ctx.tenantId,
        employeeId,
        workDate,
        checkInAt: punchRow.serverTime,
        locationId: punchRow.locationId,
        status: 'PRESENT',
      },
    });
    return;
  }

  // A check-out closes today's open day, or yesterday's for an overnight shift.
  //
  // Bounded on purpose. Searching for *any* open day let a check-out today close
  // a day from three weeks ago — someone who forgot to check out once would come
  // back to a single shift of several hundred hours. Anything older than the
  // overnight window is left open for HR to correct, because a forgotten
  // check-out is a data-quality problem and inventing an end time hides it.
  const overnightCutoff = new Date(punchRow.serverTime.getTime() - MAX_SHIFT_HOURS * 3_600_000);
  const open = await prisma.hrAttendanceRecord.findFirst({
    where: {
      tenantId: ctx.tenantId,
      employeeId,
      checkInAt: { not: null, gte: overnightCutoff },
      checkOutAt: null,
    },
    orderBy: { workDate: 'desc' },
  });
  if (!open?.checkInAt) return;

  await prisma.hrAttendanceRecord.update({
    where: { tenantId: ctx.tenantId, id: open.id },
    data: {
      checkOutAt: punchRow.serverTime,
      workMinutes: Math.max(0, Math.floor((punchRow.serverTime.getTime() - open.checkInAt.getTime()) / 60_000)),
    },
  });
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function myPunches(ctx: Ctx, limit = 30) {
  const employee = await myEmployee(ctx);
  if (!employee) return [];
  return prisma.hrAttendancePunch.findMany({
    where: { tenantId: ctx.tenantId, employeeId: employee.id },
    include: { location: { select: { name: true } } },
    // The snapshot columns hold the fence centre in force at punch time — HR
    // evidence, not the employee's to read. A rejected punch would otherwise
    // hand back the exact coordinate a spoofed retry needs.
    omit: { locLatitude: true, locLongitude: true, capturePath: true },
    orderBy: { serverTime: 'desc' },
    take: Math.min(limit, 200),
  });
}

/** An employee sees only their own days; asking for someone else's is refused. */
export async function attendanceDays(
  ctx: Ctx,
  options: { employeeId?: string; start?: Date; end?: Date; limit?: number } = {},
) {
  const self = await myEmployee(ctx);
  let employeeId = self?.id;
  if (options.employeeId && options.employeeId !== self?.id) {
    if (!isHrAdmin(ctx)) throw Forbidden('You can only view your own attendance.');
    employeeId = options.employeeId;
  }
  if (!employeeId) throw NotFound('Employee');

  return prisma.hrAttendanceRecord.findMany({
    where: {
      tenantId: ctx.tenantId,
      employeeId,
      ...(options.start || options.end
        ? {
            workDate: {
              ...(options.start ? { gte: toDay(options.start) } : {}),
              ...(options.end ? { lte: toDay(options.end) } : {}),
            },
          }
        : {}),
    },
    include: { location: { select: { name: true } }, employee: EMPLOYEE_WITH_PERSON },
    orderBy: { workDate: 'desc' },
    take: Math.min(options.limit ?? 100, 366),
  });
}

/** Punches HR should look at: simulated locations and repeated face failures. */
export async function reviewQueue(ctx: Ctx, limit = 200) {
  if (!isHrAdmin(ctx)) throw Forbidden('Only HR and administrators can review attendance.');
  return prisma.hrAttendancePunch.findMany({
    where: { tenantId: ctx.tenantId, result: { in: ['FLAGGED_REVIEW', 'REJECTED_FACE', 'REJECTED_LIVENESS'] } },
    include: { employee: EMPLOYEE_WITH_PERSON, location: { select: { name: true } } },
    orderBy: { serverTime: 'desc' },
    take: Math.min(limit, 500),
  });
}

/** Enrolment and consent state for the check-in screen and the HR employee panel. */
export async function faceStatus(ctx: Ctx, employeeId?: string) {
  const self = await myEmployee(ctx);
  const targetId = employeeId ?? self?.id;
  if (!targetId) throw NotFound('Employee');
  if (targetId !== self?.id && !isHrAdmin(ctx)) throw Forbidden('You can only view your own enrolment status.');

  const [consent, templates, health, policy] = await Promise.all([
    activeConsent(ctx, targetId),
    prisma.hrFaceTemplate.count({ where: { tenantId: ctx.tenantId, employeeId: targetId } }),
    engineHealth(),
    getHrPolicy(ctx),
  ]);
  return {
    employeeId: targetId,
    consentGrantedAt: consent?.grantedAt ?? null,
    enrolledSamples: templates,
    samplesRequired: policy.faceSamplesRequired,
    enrolled: templates >= policy.faceSamplesRequired,
    engineReady: health.ready,
    engineDetail: health.detail,
  };
}
