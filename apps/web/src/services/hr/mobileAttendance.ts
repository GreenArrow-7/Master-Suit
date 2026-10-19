/**
 * Attendance from the Lead Eagle phone app (`/api/mobile/attendance/*`, M20-10):
 * the standalone app's shapes over YOUHAN ONE's own check-in. A multipart burst
 * of camera frames and a position become the web console's `punch()` input, so
 * consent, enrolment, the liveness challenge, face match, geofence, GPS accuracy
 * and the check-out work gate are decided, recorded and audited exactly as from
 * the browser. Check-out takes the face too, as it does on the web.
 */
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { Ctx } from '@/lib/security/rbac';
import { dailyTargetProgress } from '@/services/targets/dailyBoard';
import { openCheckIn, punch, type PunchType } from './attendance';
import { myEmployee } from './leave';
import { toDay } from './rules';
import { getHrPolicy } from './settings';

/** Frames the phone sends per attempt: the first neutral, the last after the move (as the web console). */
export const PHONE_FRAMES = 3;
const MAX_FRAMES = 10;
const PHOTO_TYPES = ['image/jpeg', 'image/png'];

/** The check-in screen's header at launch: where to check in, and whether the face is on file. */
export async function launchAttendance(ctx: Ctx) {
  const employee = await myEmployee(ctx);
  if (!employee) return { location: null, enrolled: false };
  const [assignment, templates, policy] = await Promise.all([
    // ponytail: dates and status only; the location's own dates, days and hours are judged at the punch.
    prisma.hrEmployeeLocationAssignment.findFirst({
      where: {
        tenantId: ctx.tenantId,
        employeeId: employee.id,
        status: 'ACTIVE',
        checkInAllowed: true,
        location: { status: 'ACTIVE' },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: toDay(new Date()) } }],
      },
      orderBy: [{ assignmentType: 'asc' }, { assignedAt: 'asc' }],
      select: { location: { select: { name: true, radiusMeters: true } } },
    }),
    prisma.hrFaceTemplate.count({ where: { tenantId: ctx.tenantId, employeeId: employee.id } }),
    getHrPolicy(ctx),
  ]);
  return { location: assignment?.location ?? null, enrolled: templates >= policy.faceSamplesRequired };
}

/** Today's calling target as the app's task list; empty when the workspace sets none. */
async function tasks(ctx: Ctx) {
  const [target, policy] = await Promise.all([dailyTargetProgress(ctx, ctx.actor.id), getHrPolicy(ctx)]);
  if (!target) return [];
  return [
    {
      id: 'daily-target',
      label: "Today's calls",
      target: target.target,
      completed: target.called,
      isRequired: policy.checkoutRequiresDailyTarget,
      done: target.called >= target.target,
    },
  ];
}

/**
 * The open check-in, or null. `blocked` stays empty: whether the work gate holds
 * the check-out (and whether a manager lifted it) is decided at the punch, and
 * its refusal comes back as the 422 the app shows.
 */
export async function currentShift(ctx: Ctx) {
  const employee = await myEmployee(ctx);
  const open = employee ? await openCheckIn(ctx, employee.id) : null;
  if (!open) return null;
  const location = open.locationId
    ? await prisma.hrWorkLocation.findFirst({
        where: { tenantId: ctx.tenantId, id: open.locationId },
        select: { name: true },
      })
    : null;
  return {
    id: open.id,
    locationName: location?.name ?? '',
    checkInAt: open.serverTime.toISOString(),
    tasks: await tasks(ctx),
    blocked: [] as string[],
  };
}

const refuse = (code: string, message: string) => new AppError(422, code, message);

/** A form number, or null for absent, blank or not a number (`Number('')` is 0, a position in the sea). */
function formNumber(form: FormData, name: string): number | null {
  const raw = form.get(name);
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : null;
}

/**
 * Check in or out from the phone: `photo` (2 to 10 JPEG or PNG frames, in
 * order), `challengeId` (from `/challenge`), `latitude`, `longitude` and
 * `accuracyM`, as multipart. A request without frames is refused 422 before
 * anything is read or recorded, whichever way it punches; one the punch refuses
 * (outside the fence, a weak fix, liveness, face, the work gate) is recorded by
 * `punch()` and answered 422 with its message.
 */
export async function punchFromPhone(ctx: Ctx, req: Request, punchType: PunchType) {
  const multipart = (req.headers.get('content-type') ?? '').includes('multipart/form-data');
  const form = multipart ? await req.formData().catch(() => null) : null;
  const photos = (form?.getAll('photo') ?? []).filter((entry): entry is File => entry instanceof File);
  if (!form || photos.length === 0) {
    throw refuse(
      'face-required',
      punchType === 'CHECK_OUT'
        ? 'Checking out needs your face as well as your location, as checking in does. Update the app, then check out again.'
        : 'Checking in needs your face as well as your location. Open the camera and try again.',
    );
  }
  if (photos.length < 2) throw refuse('frames-required', 'The camera did not send enough frames. Try again.');
  if (photos.length > MAX_FRAMES) throw refuse('too-many-frames', `Send at most ${MAX_FRAMES} frames.`);
  if (photos.some((photo) => photo.size === 0 || !PHOTO_TYPES.includes(photo.type))) {
    throw refuse('not-a-photo', 'A frame was not a photo. Try again.');
  }

  const latitude = formNumber(form, 'latitude');
  const longitude = formNumber(form, 'longitude');
  const accuracyM = formNumber(form, 'accuracyM');
  if (
    latitude === null ||
    longitude === null ||
    accuracyM === null ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180 ||
    accuracyM < 0 ||
    accuracyM > 10_000
  ) {
    throw refuse('location-required', 'Your location could not be read. Turn on location and try again.');
  }
  const challengeId = String(form.get('challengeId') ?? '').trim();
  if (challengeId.length < 8 || challengeId.length > 200) {
    throw refuse('challenge-required', 'Start again: the camera instruction for this attempt was not sent.');
  }

  const frames = await Promise.all(
    photos.map(
      async (photo) => `data:${photo.type};base64,${Buffer.from(await photo.arrayBuffer()).toString('base64')}`,
    ),
  );
  const outcome = await punch(ctx, {
    punchType,
    nonce: challengeId,
    frames,
    latitude,
    longitude,
    gpsAccuracyM: accuracyM,
    deviceFingerprint: `mobile:${ctx.deviceSessionId ?? 'unknown'}`,
  });
  // A mock-location flag is never sent from here, so FLAGGED_REVIEW is the work gate's refusal.
  if (outcome.result !== 'ACCEPTED' || !outcome.punchId) {
    throw new AppError(422, 'punch-refused', outcome.message, [], true, { result: outcome.result });
  }
  return {
    ok: true,
    shiftId: outcome.punchId,
    locationName: outcome.locationName,
    distanceM: Math.round(outcome.distanceM),
    tasks: await tasks(ctx),
  };
}
