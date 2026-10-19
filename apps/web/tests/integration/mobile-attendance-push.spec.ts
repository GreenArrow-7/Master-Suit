const scene = vi.hoisted(() => ({ direction: 'left' as string, sameFace: true }));
vi.mock('@/services/hr/face', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/hr/face')>();
  const EMBEDDING = Array.from({ length: 8 }, (_, i) => i + 1);
  const OTHER = Array.from({ length: 8 }, (_, i) => (i % 2 ? 1 : -1));
  return {
    ...real,
    engineHealth: vi.fn(async () => ({ ready: true, detail: 'test engine' })),
    // The face engine, played: the first frame neutral, the last turned the way the server asked.
    analyse: vi.fn(async (frames: string[]) =>
      frames.map((_, i) => {
        const moved = i === frames.length - 1;
        return {
          ok: true,
          embedding: scene.sameFace ? EMBEDDING : OTHER,
          detScore: 0.9,
          blurScore: 250,
          bboxAreaRatio: 0.3,
          roll: 0,
          yaw: moved ? { left: 25, right: -25, up: 0 }[scene.direction] : 0,
          pitch: moved && scene.direction === 'up' ? 20 : 0,
        };
      }),
    ),
  };
});
// The kept evidence frame goes to object storage, which this spec does not need.
vi.mock('@/services/hr/captureVault', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/hr/captureVault')>()),
  storeCapture: vi.fn(async () => null),
}));

import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { createDeviceSession } from '@/lib/auth/session';
import { toBytes } from '@/services/hr/face';
import { DEFAULT_POLICY } from '@/services/hr/settings';
import { GET as meRoute } from '@/app/api/mobile/me/route';
import { POST as signOutRoute } from '@/app/api/mobile/auth/sign-out/route';
import { GET as shiftRoute } from '@/app/api/mobile/attendance/route';
import { POST as challengeRoute } from '@/app/api/mobile/attendance/challenge/route';
import { POST as checkInRoute } from '@/app/api/mobile/attendance/check-in/route';
import { POST as checkOutRoute } from '@/app/api/mobile/attendance/check-out/route';
import { POST as pushRoute, DELETE as pushDelete } from '@/app/api/mobile/devices/push/route';
import { signOutDevice } from '@/services/identity/accounts';
import { buildActor, buildCtx } from '../helpers/ctx';
import { createEmployee } from '../helpers/fixtures';

/**
 * The phone app's attendance and push (M20-10). Attendance follows YOUHAN ONE's
 * rules: a face and a position on check-in and on check-out, the server's
 * single-use challenge, the geofence, consent and enrolment, all through the
 * web console's `punch()`. Push registers the phone's native token (never an
 * Expo token) against this device session, which signing out forgets.
 */
const suffix = randomBytes(4).toString('hex');
const SITE = { latitude: 25.2048, longitude: 55.2708 };
const FAR = { latitude: 25.3048, longitude: 55.2708 }; // about 11 km north
const EMBEDDING = Array.from({ length: 8 }, (_, i) => i + 1);

let tenantId = '';
let agent = { userId: '', employeeId: '', token: '' };
/** An employee with consent and a location but no face on file. */
let unenrolled = { userId: '', employeeId: '', token: '' };
/** A workspace user with no employee record (a Lead Eagle-only seat). */
let seller = { userId: '', employeeId: '', token: '' };

async function phone(label: string, employee = true) {
  const made = await createEmployee({ tenantId, label, suffix });
  if (!employee) await prisma.employeeProfile.deleteMany({ where: { tenantId, id: made.employeeId } });
  const { platformUserId } = await prisma.workspaceMembership.findFirstOrThrow({
    where: { tenantId, salesUserId: made.userId },
    select: { platformUserId: true },
  });
  const { token } = await createDeviceSession({
    platformUserId,
    tenantId,
    deviceName: `${label} phone`,
    platform: 'ios',
    ip: null,
    userAgent: null,
    mfaSatisfied: false,
  });
  return { userId: made.userId, employeeId: made.employeeId, token };
}

type Handler = (req: Request, context: { params: Promise<any> }) => Promise<Response>;

async function call(handler: Handler, path: string, token: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await handler(new Request(`http://localhost${path}`, { method: 'GET', ...init, headers }), {
    params: Promise.resolve({}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** The app's multipart: distinct frames, the challenge, the position. */
function burst(
  fields: { challengeId?: string; latitude?: number; longitude?: number; accuracyM?: number },
  frames = 3,
) {
  const form = new FormData();
  for (let i = 0; i < frames; i += 1) {
    form.append('photo', new File([randomBytes(64)], `frame-${i}.jpg`, { type: 'image/jpeg' }));
  }
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.append(key, String(value));
  return { method: 'POST', body: form } satisfies RequestInit;
}

/** A challenge, with the engine primed to make the move the server asked for. */
async function challenge(token: string) {
  const res = await call(challengeRoute, '/api/mobile/attendance/challenge', token, { method: 'POST' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const stored = JSON.parse((await redis.get(`face:challenge:${res.body.challengeId}`))!);
  scene.direction = stored.direction;
  return res.body as { challengeId: string; instruction: string; expiresIn: number; frames: number };
}

const punches = (employeeId: string) => prisma.hrAttendancePunch.findMany({ where: { tenantId, employeeId } });
const checkIn = (token: string, init: RequestInit) =>
  call(checkInRoute, '/api/mobile/attendance/check-in', token, init);
const checkOut = (token: string, init: RequestInit) =>
  call(checkOutRoute, '/api/mobile/attendance/check-out', token, init);
/** A whole attempt from `where`: a fresh challenge, then the burst. */
const attempt = async (punch: typeof checkIn, token: string, where: typeof SITE) =>
  punch(token, burst({ challengeId: (await challenge(token)).challengeId, ...where, accuracyM: 10 }));

beforeAll(async () => {
  tenantId = (
    await prisma.tenant.create({
      data: { slug: `mobatt-${suffix}`, legalName: 'Mobile Attendance LLC', displayName: 'MobAtt', status: 'ACTIVE' },
    })
  ).id;
  agent = await phone('agent');
  unenrolled = await phone('unenrolled');
  seller = await phone('seller', false);

  const site = await prisma.hrWorkLocation.create({
    data: { tenantId, name: `Marina Office ${suffix}`, ...SITE, radiusMeters: 200, status: 'ACTIVE' },
  });
  for (const who of [agent, unenrolled]) {
    await prisma.hrEmployeeLocationAssignment.create({
      data: { tenantId, employeeId: who.employeeId, locationId: site.id, status: 'ACTIVE' },
    });
    await prisma.biometricConsent.create({
      data: { tenantId, employeeId: who.employeeId, grantedAt: new Date(), policyVersion: 'test' },
    });
  }
  await prisma.hrFaceTemplate.createMany({
    data: Array.from({ length: DEFAULT_POLICY.faceSamplesRequired }, () => ({
      tenantId,
      employeeId: agent.employeeId,
      embedding: toBytes(EMBEDDING),
      dim: EMBEDDING.length,
      modelVersion: 'test',
    })),
  });
});

beforeEach(() => {
  scene.sameFace = true;
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { endsWith: `-${suffix}@employee.test` } } });
});

describe('me', () => {
  it('reports the work location and the enrolment, not nothing', async () => {
    const res = await call(meRoute, '/api/mobile/me', agent.token);
    expect(res.status).toBe(200);
    expect(res.body.attendance).toEqual({
      location: { name: `Marina Office ${suffix}`, radiusMeters: 200 },
      enrolled: true,
    });
  });

  it('reports a location without enrolment, and nothing for a seat with no employee record', async () => {
    expect((await call(meRoute, '/api/mobile/me', unenrolled.token)).body.attendance).toEqual({
      location: { name: `Marina Office ${suffix}`, radiusMeters: 200 },
      enrolled: false,
    });
    expect((await call(meRoute, '/api/mobile/me', seller.token)).body.attendance).toEqual({
      location: null,
      enrolled: false,
    });
  });
});

describe('the challenge', () => {
  it("is the web console's: a server-picked move, single use, three frames", async () => {
    const issued = await challenge(agent.token);
    expect(issued.challengeId.length).toBeGreaterThan(16);
    expect(issued.instruction).toMatch(/head/i);
    expect(issued.expiresIn).toBe(DEFAULT_POLICY.challengeTtlSeconds);
    expect(issued.frames).toBe(3);
  });

  it('is refused without enrolment, without an employee record, and without the device bearer', async () => {
    const none = await call(challengeRoute, '/api/mobile/attendance/challenge', unenrolled.token, { method: 'POST' });
    expect(none.status).toBe(409);
    expect(none.body.detail).toMatch(/enrolment/);
    const seat = await call(challengeRoute, '/api/mobile/attendance/challenge', seller.token, { method: 'POST' });
    expect(seat.status).toBe(404);
    const anonymous = await call(challengeRoute, '/api/mobile/attendance/challenge', null, { method: 'POST' });
    expect(anonymous.status).toBe(401);
  });
});

describe('checking in and out from the phone', () => {
  it('refuses a check-in without frames or without a position, recording nothing and keeping the challenge', async () => {
    const { challengeId } = await challenge(agent.token);

    const faceless = await checkIn(agent.token, json({ challengeId, ...SITE, accuracyM: 10 }));
    expect(faceless.status).toBe(422);
    expect(faceless.body.detail).toMatch(/face/);

    const nowhere = await checkIn(agent.token, burst({ challengeId }));
    expect(nowhere.status).toBe(422);
    expect(nowhere.body.detail).toMatch(/location could not be read/);

    const blank = await checkIn(
      agent.token,
      burst({ challengeId, latitude: '' as never, longitude: 55.27, accuracyM: 5 }),
    );
    expect(blank.status).toBe(422);

    expect(await punches(agent.employeeId)).toHaveLength(0);
    expect(await redis.exists(`face:challenge:${challengeId}`)).toBe(1);
  });

  it('refuses outside the fence with the distance, recorded with the evidence', async () => {
    const { challengeId } = await challenge(agent.token);
    const res = await checkIn(agent.token, burst({ challengeId, ...FAR, accuracyM: 10 }));
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/metres from Marina Office/);
    expect(res.body.result).toBe('REJECTED_GEOFENCE');
    const [row] = await punches(agent.employeeId);
    expect(row).toMatchObject({ result: 'REJECTED_GEOFENCE', punchType: 'CHECK_IN' });
    expect(row!.deviceFingerprint).toMatch(/^mobile:/);
    // The challenge was spent on the attempt: a replay from inside the fence is refused.
    const replay = await checkIn(agent.token, burst({ challengeId, ...SITE, accuracyM: 10 }));
    expect(replay.status).toBe(409);
  });

  it('refuses a face that is not the enrolled one, and a burst that did not make the move', async () => {
    scene.sameFace = false;
    const stranger = await attempt(checkIn, agent.token, SITE);
    expect(stranger.status).toBe(422);
    expect(stranger.body.result).toBe('REJECTED_FACE');

    scene.sameFace = true;
    const { challengeId } = await challenge(agent.token);
    scene.direction = 'none';
    const still = await checkIn(agent.token, burst({ challengeId, ...SITE, accuracyM: 10 }));
    expect(still.status).toBe(422);
    expect(still.body.result).toBe('REJECTED_LIVENESS');
  });

  it('checks in inside the fence with the face, and the shift is open', async () => {
    const { challengeId } = await challenge(agent.token);
    const res = await checkIn(agent.token, burst({ challengeId, ...SITE, accuracyM: 10 }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ok: true, locationName: `Marina Office ${suffix}`, tasks: [] });
    const accepted = await prisma.hrAttendancePunch.findFirstOrThrow({
      where: { tenantId, employeeId: agent.employeeId, result: 'ACCEPTED' },
    });
    expect(res.body.shiftId).toBe(accepted.id);
    expect(await prisma.auditLog.count({ where: { tenantId, recordId: accepted.id } })).toBe(1);

    const shift = await call(shiftRoute, '/api/mobile/attendance', agent.token);
    expect(shift.body.shift).toMatchObject({
      id: accepted.id,
      locationName: `Marina Office ${suffix}`,
      tasks: [],
      blocked: [],
    });
  });

  it('refuses a check-out with a position and no face (the standalone app), saying why; the shift stays open', async () => {
    const res = await checkOut(agent.token, json({ ...SITE, accuracyM: 10 }));
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/Checking out needs your face/);
    expect((await call(shiftRoute, '/api/mobile/attendance', agent.token)).body.shift).not.toBeNull();
  });

  it('refuses a check-out with the face outside the fence, and checks out inside it', async () => {
    // Past the minimum interval between punches.
    await prisma.hrAttendancePunch.updateMany({
      where: { tenantId, employeeId: agent.employeeId, result: 'ACCEPTED' },
      data: { serverTime: new Date(Date.now() - 2 * 3_600_000) },
    });
    const away = await attempt(checkOut, agent.token, FAR);
    expect(away.status).toBe(422);
    expect(away.body.result).toBe('REJECTED_GEOFENCE');

    const res = await attempt(checkOut, agent.token, SITE);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      await prisma.hrAttendancePunch.count({ where: { tenantId, punchType: 'CHECK_OUT', result: 'ACCEPTED' } }),
    ).toBe(1);
    expect((await call(shiftRoute, '/api/mobile/attendance', agent.token)).body).toEqual({ shift: null });
  });

  it('refuses without the device bearer, and reads no shift for a seat with no employee record', async () => {
    expect((await checkIn(null as never, burst({}))).status).toBe(401);
    expect((await call(shiftRoute, '/api/mobile/attendance', seller.token)).body).toEqual({ shift: null });
  });
});

describe('push registration', () => {
  const tokens = (userId: string) => prisma.deviceToken.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  const register = (token: string, body: unknown) => call(pushRoute, '/api/mobile/devices/push', token, json(body));
  const apns = `${randomBytes(32).toString('hex')}`;

  it("keeps the phone's native token with its platform, bundle and device session", async () => {
    const res = await register(agent.token, { pushToken: apns, platform: 'ios', bundleId: 'ae.leadeagle.app' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [row] = await tokens(agent.userId);
    const session = await prisma.platformSession.findFirstOrThrow({
      where: { activeTenantId: tenantId, deviceLabel: 'agent phone' },
    });
    expect(row).toMatchObject({
      token: apns,
      platform: 'ios',
      bundleId: 'ae.leadeagle.app',
      deviceSessionId: session.id,
    });
  });

  it('refuses an Expo push token, explaining the native token is needed, and a token with no platform', async () => {
    const expo = await register(agent.token, { pushToken: 'ExponentPushToken[abcdefghijklmnopqrstuv]' });
    expect(expo.status).toBe(422);
    expect(expo.body.detail).toMatch(/native token \(FCM on Android, APNs on iOS\)/);
    const bare = await register(agent.token, { pushToken: `fcm-${randomBytes(20).toString('hex')}` });
    expect(bare.status).toBe(422);
    expect(bare.body.errors[0].field).toBe('platform');
    expect(await tokens(agent.userId)).toHaveLength(1);
  });

  it("forgets this phone's token on a null token, on DELETE and on sign-out, and only this phone's", async () => {
    const other = `fcm-${randomBytes(24).toString('hex')}`;
    await register(unenrolled.token, { pushToken: other, platform: 'android', bundleId: 'ae.leadeagle.app' });

    expect((await register(agent.token, { pushToken: null })).body).toEqual({ ok: true, removed: 1 });
    expect(await tokens(agent.userId)).toHaveLength(0);

    await register(agent.token, { pushToken: apns, platform: 'ios', bundleId: 'ae.leadeagle.app' });
    const deleted = await call(pushDelete, '/api/mobile/devices/push', agent.token, { method: 'DELETE' });
    expect(deleted.body).toEqual({ ok: true, removed: 1 });

    await register(agent.token, { pushToken: apns, platform: 'ios', bundleId: 'ae.leadeagle.app' });
    expect((await call(signOutRoute, '/api/mobile/auth/sign-out', agent.token, { method: 'POST' })).status).toBe(200);
    expect(await tokens(agent.userId)).toHaveLength(0);
    expect((await tokens(unenrolled.userId)).map((t) => t.token)).toEqual([other]);

    // Profile → Security → Phones signed in → Sign out, from the person's browser.
    const [row] = await tokens(unenrolled.userId);
    await signOutDevice(buildCtx(buildActor({ id: unenrolled.userId, tenantId })), row!.deviceSessionId!);
    expect(await tokens(unenrolled.userId)).toHaveLength(0);
  });
});
