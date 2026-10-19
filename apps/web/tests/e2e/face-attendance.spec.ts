import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { login, resetLoginThrottle, ok } from './helpers';

/**
 * §3 face attendance against the real face engine: supervised consent →
 * enrolment refuses too few and too-similar samples, accepts four poses → the
 * employee draws a liveness challenge → a different person is refused → the
 * nonce cannot be replayed → the enrolled person turning the wrong way is
 * refused (liveness) → turning the asked way from 2 km off is refused
 * (geofence) → turning the asked way on site is checked in → check-out.
 *
 * Face images are never committed (docs/TEST-DATA-POLICY.md): the frames come
 * from FACE_TEST_IMAGES (default tests/faces-local/), produced from public-domain
 * portraits by scripts/face-test-frames.mjs. Needs the demo workspace (E2E_DEMO_*)
 * and the face sidecar. Without any of the three it skips, except under
 * FACE_E2E=required — set by CI's face-e2e job, which starts the sidecar and
 * makes the frames, so a missing piece there fails instead of passing empty.
 */
const slug = process.env.E2E_DEMO_SLUG!;
const email = process.env.E2E_DEMO_EMAIL!;
const password = process.env.E2E_DEMO_PASSWORD!;
const base = () => process.env.APP_URL ?? 'http://localhost:3000';
const required = process.env.FACE_E2E === 'required';
const run = Date.now().toString(36);
const here = { latitude: 25.2048, longitude: 55.2708, gpsAccuracyM: 8 };
const twoKmNorth = { ...here, latitude: here.latitude + 0.018 };

const imagesDir = process.env.FACE_TEST_IMAGES || path.join(__dirname, '..', 'faces-local');
const FRAMES = [
  'a-straight',
  'a-mirror',
  'a-turned-left',
  'a-turned-right',
  'a-narrow',
  'a-portrait-2',
  'b-turned-left',
  'b-turned-right',
];
const framesPresent = FRAMES.every((name) => existsSync(path.join(imagesDir, `${name}.jpg`)));

const frame = (name: string) =>
  `data:image/jpeg;base64,${readFileSync(path.join(imagesDir, `${name}.jpg`)).toString('base64')}`;

/** Base frame then moved frame for the direction the challenge asks. */
const turn = (person: 'a' | 'b', direction: string) =>
  direction === 'left'
    ? [frame(`${person}-turned-right`), frame(`${person}-turned-left`)]
    : [frame(`${person}-turned-left`), frame(`${person}-turned-right`)];

test.describe('Face attendance', () => {
  test.skip(!required && (!slug || !email || !password), 'E2E_DEMO_SLUG / E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD not set');
  test.skip(!required && !framesPresent, `face frames not present in ${imagesDir} — run scripts/face-test-frames.mjs`);
  test.beforeEach(resetLoginThrottle);
  // A cold `next dev` compiles each of the dozen routes on first use, and the
  // check-out waits out the 61-second punch interval.
  test.setTimeout(10 * 60_000);

  test('consent → enrolment → challenge → wrong face, replay, wrong way and off-site refused → check-in → check-out', async ({
    page,
    browser,
  }) => {
    await login(page, email, password);
    const admin = page.request;
    const api = (p: string) => `${base()}${p}`;
    const act = (name: string) => api(`/api/v1/workspaces/${slug}/hr/actions/${name}`);
    const self = (name: string) => api(`/api/v1/workspaces/${slug}/hr/self/${name}`);

    const roles = await ok(await admin.get(api(`/api/v1/workspaces/${slug}/roles/roles`)), 'roles');
    const rep = ((roles.data ?? roles) as { id: string; key: string }[]).find((r) => r.key === 'sales_rep');
    expect(rep, 'seeded sales_rep role').toBeTruthy();
    const location = await ok(
      await admin.post(api(`/api/v1/workspaces/${slug}/hr/work-locations`), {
        data: { name: `Face HQ ${run}`, ...here, radiusMeters: 200 },
      }),
      'work location',
    );
    const staffEmail = `face-${run}@example.com`;
    const account = await ok(
      await admin.post(api(`/api/v1/workspaces/${slug}/identity/account-create`), {
        data: {
          fullName: `Face Staff ${run}`,
          employeeNumber: `FS-${run}`,
          email: staffEmail,
          phone: '+971500001111',
          roleId: rep!.id,
          joinedOn: new Date().toISOString().slice(0, 10),
          attendanceEligible: true,
          workLocationId: location.id,
        },
      }),
      'create staff account',
    );
    const employees = await ok(await admin.get(api(`/api/v1/workspaces/${slug}/hr/employees`)), 'employees');
    const employee = (
      (employees.data ?? employees.items ?? employees) as { id: string; employeeNumber: string }[]
    ).find((e) => e.employeeNumber === `FS-${run}`);
    expect(employee, 'employee record').toBeTruthy();
    const enrol = (frames: string[]) => admin.post(act('face-enrol'), { data: { employeeId: employee!.id, frames } });

    // No consent yet: the samples are not even looked at.
    expect((await enrol([frame('a-straight')])).status()).toBe(409);
    await ok(
      await admin.post(act('consent-grant-supervised'), {
        data: { employeeId: employee!.id, signature: `Face Staff ${run}` },
      }),
      'supervised consent',
    );

    // Too few samples: refused on the count, before the engine is asked.
    const few = await enrol([frame('a-straight'), frame('a-mirror'), frame('a-turned-left')]);
    expect(few.status(), await few.text()).toBe(409);
    // Four shots of the same pose: refused as too similar. The first call that
    // reaches the face engine, so the one that tells whether it is running.
    const same = await enrol([frame('a-straight'), frame('a-straight'), frame('a-turned-right'), frame('a-mirror')]);
    test.skip(!required && same.status() === 503, 'face engine not running');
    expect(same.status(), await same.text()).toBe(409);
    expect(await same.text()).toContain('too similar');
    // Four distinct poses: enrolled.
    await ok(
      await enrol([frame('a-mirror'), frame('a-turned-left'), frame('a-narrow'), frame('a-portrait-2')]),
      'enrolment',
    );

    // ── The employee ──────────────────────────────────────────────────────
    const ctx = await browser.newContext({ baseURL: base() });
    const me = ctx.request;
    await ok(
      await me.post(api('/api/v1/auth/login'), { data: { email: staffEmail, password: account.temporaryPassword } }),
      'staff login',
    );
    await ok(
      await me.post(api(`/api/v1/workspaces/${slug}/identity/self/password-change`), {
        data: { currentPassword: account.temporaryPassword, newPassword: `Face-${run}-Aa1xxxx` },
      }),
      'password change',
    );

    // The still portraits can be turned left and right but not tilted up
    // (scripts/face-test-frames.mjs), so an "up" challenge is drawn again; an
    // unused nonce simply expires.
    const challenge = async () => {
      for (let i = 0; i < 12; i += 1) {
        const c = await ok(await me.post(self('attendance-challenge')), 'challenge');
        if (c.direction !== 'up') return c as { nonce: string; direction: string };
      }
      throw new Error('twelve "up" challenges in a row');
    };
    const punch = (punchType: 'CHECK_IN' | 'CHECK_OUT', nonce: string, frames: string[], at = here) =>
      me.post(self('attendance-punch'), {
        data: { punchType, nonce, frames, ...at, deviceFingerprint: `e2e-${run}` },
      });

    // Someone else, turning the right way: liveness passes, recognition refuses.
    const first = await challenge();
    const stranger = await ok(await punch('CHECK_IN', first.nonce, turn('b', first.direction)), 'stranger punch');
    expect(stranger.result).toBe('REJECTED_FACE');
    // The nonce was spent on that attempt.
    const replay = await punch('CHECK_IN', first.nonce, turn('a', first.direction));
    expect(replay.status(), await replay.text()).toBe(409);

    // The enrolled person turning the other way: the face matches, liveness refuses.
    const wrongWay = await challenge();
    const backwards = turn('a', wrongWay.direction === 'left' ? 'right' : 'left');
    const unlive = await ok(await punch('CHECK_IN', wrongWay.nonce, backwards), 'wrong-way punch');
    expect(unlive.result, JSON.stringify(unlive)).toBe('REJECTED_LIVENESS');

    // The enrolled person, turning as asked, 2 km from the 200 m site: the geofence refuses.
    const away = await challenge();
    const far = await ok(await punch('CHECK_IN', away.nonce, turn('a', away.direction), twoKmNorth), 'off-site punch');
    expect(far.result, JSON.stringify(far)).toBe('REJECTED_GEOFENCE');

    // The enrolled person, turning as asked, on site.
    const second = await challenge();
    const checkIn = await ok(await punch('CHECK_IN', second.nonce, turn('a', second.direction)), 'check-in');
    expect(checkIn.result, JSON.stringify(checkIn)).toBe('ACCEPTED');
    expect(checkIn.message).toBe('Checked in.');

    // Two punches inside MIN_PUNCH_INTERVAL_SECONDS (60 by default) are a duplicate, not a check-out.
    const quick = await punch('CHECK_OUT', (await challenge()).nonce, turn('a', 'left'));
    expect((await quick.json()).result).toBe('REJECTED_DUPLICATE');
    await new Promise((r) => setTimeout(r, 61_000));

    const third = await challenge();
    const checkOut = await ok(await punch('CHECK_OUT', third.nonce, turn('a', third.direction)), 'check-out');
    expect(checkOut.result, JSON.stringify(checkOut)).toBe('ACCEPTED');
    expect(checkOut.message).toBe('Checked out.');

    // The monitor sees the day.
    const days = await ok(await admin.get(api(`/api/v1/workspaces/${slug}/hr/attendance`)), 'attendance');
    const day = (
      (days.data ?? days.items ?? days) as { employeeId: string; checkInAt?: string; checkOutAt?: string }[]
    ).find((d) => d.employeeId === employee!.id);
    expect(day, 'attendance day for the employee').toBeTruthy();
    expect(day!.checkInAt).toBeTruthy();
    expect(day!.checkOutAt).toBeTruthy();
    await ctx.close();
  });
});
