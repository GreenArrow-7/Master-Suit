/**
 * An authenticator code is accepted once.
 *
 * A TOTP code is valid for about ninety seconds. Before this, anyone who saw one
 * — over a shoulder, through a phishing proxy, in a second tab — could use it
 * again inside that window, and two requests carrying it could both succeed.
 * Rate limiting bounds how often that is tried; it does not stop it happening.
 *
 * Every acceptance now spends the code's time step atomically
 * (lib/auth/totp-consume.ts). These cases replay codes through the real routes
 * and services — sign-in, concurrent sign-in, credential re-authentication,
 * revoking another person's credential, enrolment, workspace two-factor
 * management and recovery codes — and then move the clock one step forward to
 * show each flow still works with the authenticator's next code.
 *
 * This file never clears a spent step (tests/helpers/totp.ts is not used here).
 */
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));

import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { currentTotpStep, generateSecret, totp } from '@/lib/auth/mfa';
import { encryptSecret } from '@/services/identity/secrets';
import { clear as clearLimit, limits } from '@/lib/security/ratelimit';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { POST as enroll2fa } from '@/app/api/v1/auth/enroll-2fa/route';
import { POST as credentialsPost } from '@/app/api/v1/platform/credentials/route';
import { POST as userActions } from '@/app/api/v1/platform/users/[userId]/actions/route';
import { POST as selfService } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/self/[action]/route';
import { createSessionToken } from '../helpers/session';

const suffix = randomBytes(4).toString('hex');
const PASSWORD = `Replay-${suffix}-Pass1`;
const SECRET = generateSecret();
const OWNER2_SECRET = generateSecret();
const MEMBER_SECRET = generateSecret();

const ownerEmail = `replay.owner.${suffix}@platform.test`;
const owner2Email = `replay.owner2.${suffix}@platform.test`;
const enrolEmail = `replay.enrol.${suffix}@platform.test`;
const memberEmail = `replay.member.${suffix}@customer.test`;

let ownerId = '';
let owner2Id = '';
let enrolId = '';
let memberPlatformId = '';
let memberCookie = '';
let tenant = { id: '', slug: '' };

const codeAt = (secret: string, step = currentTotpStep()) => totp(secret, step);

function request(url: string, method = 'GET', body?: unknown, cookie?: string) {
  return new Request(url, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function callLogin(body: Record<string, unknown>) {
  const res = await login(request('http://localhost/api/v1/auth/login', 'POST', body));
  const json = await res.json().catch(() => null);
  // Each call gets its own jar read: concurrent calls must not share a cookie.
  const token = jar.get(SESSION_COOKIE) ?? null;
  jar.delete(SESSION_COOKIE);
  return { status: res.status, json, token };
}

async function limitsCleared(...ids: string[]) {
  await clearLimit(limits.loginPerIp('unknown'));
  for (const email of [ownerEmail, owner2Email, enrolEmail, memberEmail]) {
    await clearLimit(limits.loginPerAccount(email));
  }
  for (const id of ids) await clearLimit(limits.mfaConfirm(id));
}

/**
 * Moves the clock to the start of the next time step, as waiting for the next
 * code would. Monotonic across tests: each test re-installs fake timers at the
 * real time, which can be behind a step an earlier test already spent.
 */
let clockMs = Date.now();
function nextStep() {
  const base = Math.max(clockMs, Date.now());
  clockMs = (Math.floor(base / 30_000) + 1) * 30_000 + 500;
  vi.setSystemTime(clockMs);
}

async function staff(email: string, secret: string | null) {
  const user = await prisma.platformUser.create({
    data: {
      email,
      normalizedEmail: email,
      fullName: `Replay ${suffix}`,
      passwordHash: await hashPassword(PASSWORD),
      status: 'ACTIVE',
      platformRole: 'OWNER',
      passwordChangedAt: new Date(),
      ...(secret ? { mfaEnabled: true, mfaSecret: encryptSecret(secret) } : {}),
    },
  });
  return user.id;
}

beforeAll(async () => {
  ownerId = await staff(ownerEmail, SECRET);
  owner2Id = await staff(owner2Email, OWNER2_SECRET);
  enrolId = await staff(enrolEmail, null);

  const created = await prisma.tenant.create({
    data: { slug: `replay-${suffix}`, legalName: 'Replay LLC', displayName: 'Replay Co', status: 'ACTIVE' },
  });
  tenant = { id: created.id, slug: created.slug };
  const role = await prisma.role.create({
    data: { tenantId: tenant.id, key: `member-${suffix}`, name: 'Member', rank: 50, defaultScope: 'OWN' },
  });
  const member = await prisma.platformUser.create({
    data: {
      email: memberEmail,
      normalizedEmail: memberEmail,
      fullName: 'Replay member',
      passwordHash: await hashPassword(PASSWORD),
      status: 'ACTIVE',
      passwordChangedAt: new Date(),
      mfaEnabled: true,
      mfaSecret: encryptSecret(MEMBER_SECRET),
    },
  });
  memberPlatformId = member.id;
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, email: memberEmail, fullName: 'Replay member', roleId: role.id, status: 'ACTIVE' },
  });
  await prisma.workspaceMembership.create({
    data: {
      tenantId: tenant.id,
      platformUserId: member.id,
      salesUserId: user.id,
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });
  memberCookie = await createSessionToken(tenant.id, user.id);
});

afterEach(() => {
  vi.useRealTimers();
  jar.clear();
});

afterAll(async () => {
  if (tenant.id) await prisma.tenant.delete({ where: { id: tenant.id } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: `.${suffix}@` } } }).catch(() => {});
});

describe('sign-in', () => {
  it('a code that signed in is refused the second time, and the trail says replay', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    nextStep();
    await limitsCleared(ownerId);
    const code = codeAt(SECRET);
    const first = await callLogin({ email: ownerEmail, password: PASSWORD, mfaCode: code });
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(first.token).toBeTruthy();

    const replay = await callLogin({ email: ownerEmail, password: PASSWORD, mfaCode: code });
    expect(replay.status).toBe(401);
    expect(replay.token).toBeNull();
    // The same generic answer as a wrong code…
    const wrong = await callLogin({
      email: ownerEmail,
      password: PASSWORD,
      mfaCode: code === '000000' ? '111111' : '000000',
    });
    expect(replay.json.detail).toBe(wrong.json.detail);
    // …but the platform audit trail names it.
    const event = await prisma.platformAuditEvent.findFirst({
      where: { objectId: ownerId, event: 'LOGIN_FAILED' },
      orderBy: { occurredAt: 'desc' },
      select: { metadata: true, occurredAt: true },
    });
    const reasons = await prisma.platformAuditEvent.findMany({
      where: { objectId: ownerId, event: 'LOGIN_FAILED' },
      select: { metadata: true },
    });
    expect(event).toBeTruthy();
    expect(reasons.some((row) => (row.metadata as { reason?: string }).reason === 'MFA_CODE_REPLAYED')).toBe(true);

    // The authenticator's next code signs in.
    nextStep();
    await limitsCleared(ownerId);
    const next = await callLogin({ email: ownerEmail, password: PASSWORD, mfaCode: codeAt(SECRET) });
    expect(next.status).toBe(200);
  });

  it('an earlier code than the last accepted one is refused too', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    nextStep();
    await limitsCleared(ownerId);
    const step = currentTotpStep();
    // Accept the next step's code first (clock drift allows it)…
    expect((await callLogin({ email: ownerEmail, password: PASSWORD, mfaCode: codeAt(SECRET, step + 1) })).status).toBe(
      200,
    );
    // …then the current step's code, never used, is refused.
    await limitsCleared(ownerId);
    expect((await callLogin({ email: ownerEmail, password: PASSWORD, mfaCode: codeAt(SECRET, step) })).status).toBe(
      401,
    );
    nextStep();
    nextStep();
  });

  it('two sign-ins racing with one code produce exactly one session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    nextStep();
    nextStep();
    await limitsCleared(ownerId);
    const first = await callLogin({ email: ownerEmail, password: PASSWORD });
    const second = await callLogin({ email: ownerEmail, password: PASSWORD });
    const code = codeAt(SECRET);
    const results = await Promise.all([
      login(request('http://localhost/api/v1/auth/login', 'POST', { challenge: first.json.challenge, mfaCode: code })),
      login(request('http://localhost/api/v1/auth/login', 'POST', { challenge: second.json.challenge, mfaCode: code })),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 401]);
  });
});

describe('credential management', () => {
  async function adminSession() {
    nextStep();
    await limitsCleared(ownerId);
    const res = await callLogin({ email: ownerEmail, password: PASSWORD, mfaCode: codeAt(SECRET) });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    return `${SESSION_COOKIE}=${res.token}`;
  }
  const credentials = (cookie: string, body: unknown) =>
    credentialsPost(request('http://localhost/api/v1/platform/credentials', 'POST', body, cookie));

  it('the code that signed in cannot also confirm a credential change; the next one can', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const cookie = await adminSession();
    const spent = codeAt(SECRET);
    const refused = await credentials(cookie, {
      action: 'set-monitoring',
      currentPassword: PASSWORD,
      mfaCode: spent,
      newPassword: `Monitor-${suffix}-Pass7`,
    });
    expect(refused.status).toBe(403);
    expect((await refused.json()).detail).toMatch(/already been used/);
    expect((await prisma.platformUser.findUnique({ where: { id: ownerId } }))!.monitoringPasswordHash).toBeNull();
    const audit = await prisma.platformAuditEvent.findFirst({
      where: { objectId: ownerId, event: 'CREDENTIAL_REAUTHENTICATION_FAILED' },
      orderBy: { occurredAt: 'desc' },
    });
    expect((audit!.metadata as { reason?: string }).reason).toBe('MFA_CODE_REPLAYED');

    nextStep();
    await limitsCleared(ownerId);
    const accepted = await credentials(cookie, {
      action: 'set-monitoring',
      currentPassword: PASSWORD,
      mfaCode: codeAt(SECRET),
      newPassword: `Monitor-${suffix}-Pass7`,
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
  });

  it('two concurrent credential changes with one code: exactly one applies', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const cookie = await adminSession();
    nextStep();
    await limitsCleared(ownerId);
    const before = await prisma.platformUser.findUnique({
      where: { id: ownerId },
      select: { monitoringPasswordVersion: true },
    });
    const code = codeAt(SECRET);
    const results = await Promise.all(
      ['First', 'Second'].map((label) =>
        credentials(cookie, {
          action: 'set-monitoring',
          currentPassword: PASSWORD,
          mfaCode: code,
          newPassword: `${label}-${suffix}-Monitor9`,
        }),
      ),
    );
    expect(results.map((res) => res.status).sort()).toEqual([200, 403]);
    const after = await prisma.platformUser.findUnique({
      where: { id: ownerId },
      select: { monitoringPasswordVersion: true },
    });
    expect(after!.monitoringPasswordVersion).toBe(before!.monitoringPasswordVersion + 1);
  });

  it("revoking another person's monitoring password spends the acting owner's code", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    nextStep();
    await limitsCleared(owner2Id);
    const owner2 = await callLogin({ email: owner2Email, password: PASSWORD, mfaCode: codeAt(OWNER2_SECRET) });
    expect(owner2.status).toBe(200);
    const cookie = `${SESSION_COOKIE}=${owner2.token}`;
    const act = (code: string) =>
      userActions(
        request(
          `http://localhost/api/v1/platform/users/${ownerId}/actions`,
          'POST',
          { action: 'revoke-monitoring-credential', mfaCode: code },
          cookie,
        ),
        { params: Promise.resolve({ userId: ownerId }) },
      );
    // The sign-in code is spent.
    expect((await act(codeAt(OWNER2_SECRET))).status).toBe(403);
    nextStep();
    await limitsCleared(owner2Id);
    const code = codeAt(OWNER2_SECRET);
    expect((await act(code)).status).toBe(200);
    expect((await prisma.platformUser.findUnique({ where: { id: ownerId } }))!.monitoringPasswordHash).toBeNull();
  });
});

describe('enrolment', () => {
  it('the code that confirmed enrolment cannot sign in; the next code does', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    nextStep();
    await limitsCleared(enrolId);
    const grant = await callLogin({ email: enrolEmail, password: PASSWORD });
    expect(grant.json.mfaEnrolmentRequired).toBe(true);
    const grantCookie = `${SESSION_COOKIE}=${grant.token}`;
    jar.set(SESSION_COOKIE, grant.token!);
    const begin = await enroll2fa(
      request('http://localhost/api/v1/auth/enroll-2fa', 'POST', { step: 'begin' }, grantCookie),
    );
    const secret = (await begin.json()).secret as string;
    const code = codeAt(secret);
    const confirm = await enroll2fa(
      request('http://localhost/api/v1/auth/enroll-2fa', 'POST', { step: 'confirm', code }, grantCookie),
    );
    expect(confirm.status, await confirm.clone().text()).toBe(200);
    jar.clear();

    await limitsCleared(enrolId);
    expect((await callLogin({ email: enrolEmail, password: PASSWORD, mfaCode: code })).status).toBe(401);
    nextStep();
    await limitsCleared(enrolId);
    expect((await callLogin({ email: enrolEmail, password: PASSWORD, mfaCode: codeAt(secret) })).status).toBe(200);
  });
});

describe('workspace two-factor management and recovery codes', () => {
  const self = (action: string, body: unknown) =>
    selfService(
      request(`http://localhost/api/v1/workspaces/${tenant.slug}/identity/self/${action}`, 'POST', body, memberCookie),
      { params: Promise.resolve({ workspaceSlug: tenant.slug, action }) },
    );

  it('regenerating recovery codes spends the code; a replay is refused and says so', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    nextStep();
    await limitsCleared(memberPlatformId);
    const code = codeAt(MEMBER_SECRET);
    const first = await self('two-factor-recovery-regenerate', { code });
    expect(first.status, await first.clone().text()).toBe(200);
    const replay = await self('two-factor-recovery-regenerate', { code });
    expect(replay.status).toBe(403);
    expect(await replay.text()).toMatch(/already been used/);
    nextStep();
    expect((await self('two-factor-recovery-regenerate', { code: codeAt(MEMBER_SECRET) })).status).toBe(200);
  });

  it('one recovery code, two concurrent sign-ins: exactly one succeeds; two different codes both work', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    nextStep();
    await limitsCleared(memberPlatformId);
    const regenerated = await self('two-factor-recovery-regenerate', { code: codeAt(MEMBER_SECRET) });
    const codes = (await regenerated.json()).recoveryCodes as string[];
    expect(codes.length).toBeGreaterThan(2);

    await limitsCleared(memberPlatformId);
    const same = await Promise.all([
      login(
        request('http://localhost/api/v1/auth/login', 'POST', {
          email: memberEmail,
          password: PASSWORD,
          recoveryCode: codes[0],
        }),
      ),
      login(
        request('http://localhost/api/v1/auth/login', 'POST', {
          email: memberEmail,
          password: PASSWORD,
          recoveryCode: codes[0],
        }),
      ),
    ]);
    expect(same.map((res) => res.status).sort()).toEqual([200, 401]);

    await limitsCleared(memberPlatformId);
    const different = await Promise.all([
      login(
        request('http://localhost/api/v1/auth/login', 'POST', {
          email: memberEmail,
          password: PASSWORD,
          recoveryCode: codes[1],
        }),
      ),
      login(
        request('http://localhost/api/v1/auth/login', 'POST', {
          email: memberEmail,
          password: PASSWORD,
          recoveryCode: codes[2],
        }),
      ),
    ]);
    expect(different.map((res) => res.status)).toEqual([200, 200]);
    const remaining = (await prisma.platformUser.findUnique({
      where: { id: memberPlatformId },
      select: { mfaRecoveryCodes: true },
    }))!.mfaRecoveryCodes;
    expect(remaining).toHaveLength(codes.length - 3);
  });
});

describe('no path accepts a code without spending it', () => {
  it('only lib/auth/totp-consume.ts calls the step matcher', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const path = await import('node:path');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry) && /matchTotpStep|verifyTotp/.test(readFileSync(full, 'utf8')))
          offenders.push(full);
      }
    };
    walk(path.resolve(__dirname, '../../src'));
    const normalised = offenders
      .map((file) =>
        file
          .split(path.sep)
          .join('/')
          .replace(/^.*\/src\//, 'src/'),
      )
      .sort();
    expect(normalised).toEqual(['src/lib/auth/mfa.ts', 'src/lib/auth/totp-consume.ts']);
  });
});
