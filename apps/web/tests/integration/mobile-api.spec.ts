const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { generateSecret, totp, currentTotpStep } from '@/lib/auth/mfa';
import { encryptSecret } from '@/services/identity/secrets';
import { clear as clearLimit, limits } from '@/lib/security/ratelimit';
import { createDeviceSession, revokeAllSessions, SESSION_COOKIE } from '@/lib/auth/session';
import { POST as signInRoute } from '@/app/api/mobile/auth/sign-in/route';
import { POST as signOutRoute } from '@/app/api/mobile/auth/sign-out/route';
import { GET as meRoute } from '@/app/api/mobile/me/route';
import { GET as leadsRoute } from '@/app/api/mobile/leads/route';
import { POST as callRoute } from '@/app/api/mobile/leads/[leadId]/call/route';
import { POST as statusRoute } from '@/app/api/mobile/leads/[leadId]/status/route';
import { GET as followUpsRoute } from '@/app/api/mobile/follow-ups/route';
import { GET as v1Leads } from '@/app/api/v1/leads/route';
import { POST as refreshRoute } from '@/app/api/v1/auth/refresh/route';
import { POST as logoutAll } from '@/app/api/v1/auth/logout-all/route';
import { POST as selfService } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/self/[action]/route';
import { createWorkspaceUser, grantPermissions, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { createSessionToken } from '../helpers/session';

/**
 * The phone's API (M20-10), ported from the standalone Lead Eagle's
 * tests/integration/mobile-api.spec.ts. A device token is no easier a way in
 * than the web form — same throttle, lockout, refused accounts and second
 * factor — and works only as itself: a bearer on /api/mobile, for its one
 * workspace, ended by every revocation. A replayed call is not logged twice, a
 * key is the person's, and a call keeps its real time but never a future one.
 */
const suffix = randomBytes(4).toString('hex');
const PASSWORD = `Mobile-${suffix}-Pass1`;
const MFA_SECRET = generateSecret();
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const email = (who: string) => `${who}.${suffix}@mobile.test`;

let fixture: Fixture;
let tenantId = '';
let slug = '';
let agentId = '';
let agentLeadId = '';
let adminLeadId = '';
let strangerLeadId = '';
/** A device token for the agent (leads at OWN, numbers masked) and the manager (all leads, numbers shown). */
let agentToken = '';
let managerToken = '';

async function person(
  who: string,
  roleId: string,
  extra: { mfa?: boolean; passwordChangedAt?: Date | null; tenant?: string } = {},
) {
  const user = await createWorkspaceUser({
    tenantId: extra.tenant ?? tenantId,
    roleId,
    email: email(who),
    fullName: `The ${who}`,
    password: PASSWORD,
  });
  await prisma.platformUser.update({
    where: { id: user.platformUserId },
    data: {
      passwordChangedAt: extra.passwordChangedAt === undefined ? new Date() : extra.passwordChangedAt,
      ...(extra.mfa ? { mfaEnabled: true, mfaSecret: encryptSecret(MFA_SECRET) } : {}),
    },
  });
  return user;
}

async function role(key: string, grants: Parameters<typeof grantPermissions>[2], scope: 'OWN' | 'ORGANIZATION') {
  const created = await prisma.role.create({ data: { tenantId, key: `${key}-${suffix}`, name: key, rank: 80 } });
  await grantPermissions(tenantId, created.id, grants, scope);
  return created.id;
}

async function signIn(body: Record<string, unknown>, keepLimits = false) {
  if (!keepLimits) {
    await clearLimit(limits.loginPerIp('unknown'));
    if (typeof body.email === 'string') await clearLimit(limits.loginPerAccount(body.email));
  }
  const res = await signInRoute(
    new Request('http://localhost/api/mobile/auth/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest-phone' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
  return { status: res.status, body: await res.json() };
}

type Handler = (req: Request, context: { params: Promise<any> }) => Promise<Response>;

async function call(
  handler: Handler,
  path: string,
  init: {
    token?: string;
    cookie?: string;
    method?: string;
    body?: unknown;
    key?: string;
    params?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.cookie) headers.cookie = init.cookie;
  if (init.key) headers['idempotency-key'] = init.key;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }),
    { params: Promise.resolve(init.params ?? {}) },
  );
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

const logCall = (token: string, leadId: string, body: Record<string, unknown>, key?: string) =>
  call(callRoute, `/api/mobile/leads/${leadId}/call`, { token, body, key, params: { leadId } });
const calls = (leadId: string, outcome?: string) =>
  prisma.activity.count({ where: { tenantId, leadId, ...(outcome ? { outcome } : {}) } });
const me = (token: string) => call(meRoute, '/api/mobile/me', { token });
const deviceFor = async (userId: string, deviceName = 'Spare phone') => {
  const membership = await prisma.workspaceMembership.findFirstOrThrow({
    where: { tenantId, salesUserId: userId },
    select: { platformUserId: true },
  });
  return (
    await createDeviceSession({
      platformUserId: membership.platformUserId,
      tenantId,
      deviceName,
      platform: 'android',
      ip: null,
      userAgent: null,
      mfaSatisfied: false,
    })
  ).token;
};

beforeAll(async () => {
  fixture = await seedTwoTenants();
  tenantId = fixture.a.tenantId;
  slug = fixture.a.slug;
  adminLeadId = fixture.a.leadIds[0]!;
  strangerLeadId = fixture.b.leadIds[0]!;
  await prisma.lead.updateMany({
    where: { tenantId },
    data: { phone: '+971501234567', phoneNormalized: '+971501234567' },
  });

  const agentRole = await role(
    'agent',
    [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
    ],
    'OWN',
  );
  const managerRole = await role(
    'manager',
    [
      ['leads', 'VIEW'],
      ['leads', 'EDIT'],
      ['leads', 'VIEW_SENSITIVE_FIELDS'],
    ],
    'ORGANIZATION',
  );
  agentId = (await person('agent', agentRole)).id;
  await person('manager', managerRole);
  await person('mfa', agentRole, { mfa: true });
  await person('locked', agentRole);
  await person('temporary', agentRole, { passwordChangedAt: null });
  await person('changer', agentRole);
  await person('leaver', agentRole);

  agentLeadId = (
    await prisma.lead.create({
      data: {
        tenantId,
        reference: `MOB-${suffix}`,
        fullName: 'Mariam Saleh',
        phone: '+971509876543',
        phoneNormalized: '+971509876543',
        stageId: fixture.a.stageId,
        ownerId: agentId,
      },
    })
  ).id;

  const agent = await signIn({
    workspace: slug,
    email: email('agent'),
    password: PASSWORD,
    deviceName: 'Test iPhone',
    platform: 'ios',
  });
  expect(agent.status, JSON.stringify(agent.body)).toBe(200);
  agentToken = agent.body.token;
  const manager = await signIn({ workspace: slug, email: email('manager'), password: PASSWORD });
  expect(manager.status, JSON.stringify(manager.body)).toBe(200);
  managerToken = manager.body.token;
});

beforeEach(() => jar.clear());

afterAll(async () => {
  await fixture.cleanup();
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { endsWith: `.${suffix}@mobile.test` } } });
});

describe('signing a phone in', () => {
  it('answers a 256-bit bearer for the one workspace, kept only as a hash, for 90 days, with no cookie', async () => {
    const [prefix, secret] = agentToken.split(/\.(.+)/);
    expect(prefix).toBe(tenantId);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    const row = await prisma.platformSession.findUnique({ where: { tokenHash: sha256(secret!) } });
    expect(row).toMatchObject({
      kind: 'MOBILE',
      activeTenantId: tenantId,
      deviceLabel: 'Test iPhone',
      platform: 'ios',
      revokedAt: null,
    });
    const days = (row!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
    expect(jar.size).toBe(0);
    const audit = await prisma.platformAuditEvent.findFirst({
      where: { tenantId, event: 'LOGIN', objectId: row!.platformUserId },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit?.metadata).toMatchObject({ device: 'MOBILE', platform: 'ios' });
  });

  it('refuses a wrong password, a workspace the person is not in, staff and a suspended account alike', async () => {
    const wrong = await signIn({ workspace: slug, email: email('agent'), password: 'not-it-at-all' });
    expect(wrong.status).toBe(401);
    const elsewhere = await signIn({ workspace: fixture.b.slug, email: email('agent'), password: PASSWORD });
    expect(elsewhere.status).toBe(401);
    expect(elsewhere.body.detail).toBe(wrong.body.detail);

    const owner = await prisma.platformUser.create({
      data: {
        email: email('owner'),
        normalizedEmail: email('owner'),
        fullName: 'Platform owner',
        passwordHash: (await prisma.platformUser.findFirstOrThrow({ where: { normalizedEmail: email('agent') } }))
          .passwordHash,
        status: 'ACTIVE',
        platformRole: 'OWNER',
        passwordChangedAt: new Date(),
      },
    });
    const staff = await signIn({ workspace: slug, email: email('owner'), password: PASSWORD });
    expect(staff.status).toBe(401);
    expect(staff.body.detail).toBe(wrong.body.detail);
    await prisma.platformUser.delete({ where: { id: owner.id } });

    await prisma.platformUser.updateMany({
      where: { normalizedEmail: email('leaver') },
      data: { status: 'SUSPENDED' },
    });
    const suspended = await signIn({ workspace: slug, email: email('leaver'), password: PASSWORD });
    expect(suspended.status).toBe(401);
    expect(suspended.body.detail).toBe(wrong.body.detail);
    await prisma.platformUser.updateMany({ where: { normalizedEmail: email('leaver') }, data: { status: 'ACTIVE' } });
  });

  it('throttles and locks out as the web form does', async () => {
    await clearLimit(limits.loginPerIp('unknown'));
    await clearLimit(limits.loginPerAccount(email('locked')));
    for (let i = 0; i < 5; i++) {
      const miss = await signIn({ workspace: slug, email: email('locked'), password: 'wrong-wrong' }, true);
      expect(miss.status).toBe(401);
    }
    const throttled = await signIn({ workspace: slug, email: email('locked'), password: PASSWORD }, true);
    expect(throttled.status).toBe(429);
    // Past the throttle, the five misses have locked the account: the right password is refused too.
    const locked = await signIn({ workspace: slug, email: email('locked'), password: PASSWORD });
    expect(locked.status).toBe(401);
    expect(await prisma.platformSession.count({ where: { platformUser: { normalizedEmail: email('locked') } } })).toBe(
      0,
    );
  });

  it('asks for the second factor in a second request when the account has one', async () => {
    const first = await signIn({ workspace: slug, email: email('mfa'), password: PASSWORD, deviceName: 'MFA phone' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ mfaRequired: true });
    expect(first.body.token).toBeUndefined();

    const bad = await signIn({
      workspace: slug,
      challenge: first.body.challenge,
      mfaCode: totp(MFA_SECRET, currentTotpStep()) === '000000' ? '111111' : '000000',
    });
    expect(bad.status).toBe(401);

    const second = await signIn({
      workspace: slug,
      challenge: first.body.challenge,
      mfaCode: totp(MFA_SECRET, currentTotpStep()),
      deviceName: 'MFA phone',
    });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect((await me(second.body.token)).status).toBe(200);
    const row = await prisma.platformSession.findUnique({
      where: { tokenHash: sha256(second.body.token.split(/\.(.+)/)[1]) },
    });
    expect(row).toMatchObject({ kind: 'MOBILE', mfaSatisfied: true });
  });

  it('sends a workspace that requires two factors, without one enrolled, to the web — no session', async () => {
    await prisma.organizationSetting.upsert({
      where: { tenantId },
      update: { mfaRequired: true },
      create: { tenantId, mfaRequired: true },
    });
    const refused = await signIn({ workspace: slug, email: email('changer'), password: PASSWORD });
    await prisma.organizationSetting.update({ where: { tenantId }, data: { mfaRequired: false } });
    expect(refused.status).toBe(403);
    expect(await prisma.platformSession.count({ where: { platformUser: { normalizedEmail: email('changer') } } })).toBe(
      0,
    );
  });

  it('sends an administrator-issued password to the web to be replaced first', async () => {
    const temporary = await signIn({ workspace: slug, email: email('temporary'), password: PASSWORD });
    expect(temporary.status).toBe(403);
    expect(temporary.body.detail).toMatch(/password on the web/);
  });
});

describe('a device token', () => {
  it('resolves to the person and workspace it was issued for', async () => {
    const res = await me(agentToken);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: agentId, fullName: 'The agent', maskContactDetails: true });
    expect(res.body.user.permissions.leads).toEqual(expect.arrayContaining(['VIEW', 'EDIT']));
    expect(res.body.workspace).toMatchObject({ slug, dialCode: '971' });
  });

  it('is refused when it is missing, nonsense, wrong, or a browser session', async () => {
    expect((await call(meRoute, '/api/mobile/me')).status).toBe(401);
    expect((await me('not-a-token')).status).toBe(401);
    expect((await me(`${tenantId}.wrong`)).status).toBe(401);
    // A signed-in browser's cookie is not accepted here…
    const cookie = await createSessionToken(tenantId, agentId);
    expect((await call(meRoute, '/api/mobile/me', { cookie })).status).toBe(401);
    // …nor its token dressed as a bearer.
    expect((await me(`${tenantId}.${cookie.split('=')[1]}`)).status).toBe(401);
  });

  it('cannot be pointed at another workspace by editing its prefix', async () => {
    const [, secret] = agentToken.split(/\.(.+)/);
    expect((await me(`${fixture.b.tenantId}.${secret}`)).status).toBe(401);
  });

  it('is not a browser session: refused as a cookie on the web API and by the refresh route', async () => {
    const [, secret] = agentToken.split(/\.(.+)/);
    for (const cookie of [`${SESSION_COOKIE}=${secret}`, `${SESSION_COOKIE}=${agentToken}`]) {
      expect((await call(v1Leads, '/api/v1/leads', { cookie })).status).toBe(401);
    }
    // Nor as a bearer there: an API key never parses as one.
    expect((await call(v1Leads, '/api/v1/leads', { token: agentToken })).status).toBe(401);

    jar.set(SESSION_COOKIE, secret!);
    const rotated = await refreshRoute(new Request('http://localhost/api/v1/auth/refresh', { method: 'POST' }), {
      params: Promise.resolve({}),
    });
    expect(rotated.status).toBe(401);
    expect(jar.has(SESSION_COOKIE)).toBe(true);
    expect((await me(agentToken)).status).toBe(200);
  });

  it('stops working when this phone signs out, and only this phone', async () => {
    const spare = await deviceFor(agentId);
    const out = await call(signOutRoute, '/api/mobile/auth/sign-out', { token: spare, method: 'POST' });
    expect(out.status).toBe(200);
    expect((await me(spare)).status).toBe(401);
    expect((await me(agentToken)).status).toBe(200);
  });

  it('is listed under Profile → Security, where its Sign out ends it; another person cannot reach it', async () => {
    const lost = await deviceFor(agentId, 'Lost phone');
    const [, secret] = lost.split(/\.(.+)/);
    const row = await prisma.platformSession.findUniqueOrThrow({ where: { tokenHash: sha256(secret!) } });
    const self = (action: string, cookie: string, body: Record<string, unknown>) =>
      call(selfService, `/api/v1/workspaces/${slug}/identity/self/${action}`, {
        cookie,
        body,
        params: { workspaceSlug: slug, action },
      });

    const manager = await prisma.user.findFirstOrThrow({ where: { tenantId, email: email('manager') } });
    const someoneElse = await self('device-sign-out', await createSessionToken(tenantId, manager.id), { id: row.id });
    expect(someoneElse.status).toBe(404);
    expect((await me(lost)).status).toBe(200);

    const mine = await self('device-sign-out', await createSessionToken(tenantId, agentId), { id: row.id });
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect((await me(lost)).status).toBe(401);
  });

  it('dies with a password change, sign-out everywhere, and the hooks behind suspension, removal and role changes', async () => {
    const changer = await prisma.user.findFirstOrThrow({ where: { tenantId, email: email('changer') } });
    const phone = await deviceFor(changer.id);
    const cookie = await createSessionToken(tenantId, changer.id);
    const changed = await call(selfService, `/api/v1/workspaces/${slug}/identity/self/password-change`, {
      cookie,
      body: { currentPassword: PASSWORD, newPassword: `Changed-${suffix}-Passw0rd!` },
      params: { workspaceSlug: slug, action: 'password-change' },
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect((await me(phone)).status).toBe(401);

    const leaver = await prisma.user.findFirstOrThrow({ where: { tenantId, email: email('leaver') } });
    const everywhere = await deviceFor(leaver.id);
    jar.set(SESSION_COOKIE, (await createSessionToken(tenantId, leaver.id)).split('=')[1]!);
    const all = await logoutAll(new Request('http://localhost/api/v1/auth/logout-all', { method: 'POST' }), {
      params: Promise.resolve({}),
    });
    expect(all.status).toBe(200);
    expect((await me(everywhere)).status).toBe(401);

    // setUserActive, deleteUser, changeUserRole, the role editor and an ended
    // employment all end access through this one call.
    const hooked = await deviceFor(leaver.id);
    await revokeAllSessions(leaver.id, undefined, 'ACCOUNT_SUSPENDED');
    expect((await me(hooked)).status).toBe(401);
  });

  it('is refused the moment the membership is no longer active, revoked or not', async () => {
    const leaver = await prisma.user.findFirstOrThrow({ where: { tenantId, email: email('leaver') } });
    const phone = await deviceFor(leaver.id);
    expect((await me(phone)).status).toBe(200);
    await prisma.workspaceMembership.updateMany({ where: { salesUserId: leaver.id }, data: { status: 'SUSPENDED' } });
    expect((await me(phone)).status).toBe(401);
    await prisma.workspaceMembership.updateMany({ where: { salesUserId: leaver.id }, data: { status: 'ACTIVE' } });
  });
});

describe('logging a call from a phone', () => {
  it('writes one activity through the web call log, with its follow-up', async () => {
    const before = await calls(agentLeadId);
    const res = await logCall(agentToken, agentLeadId, {
      outcome: 'CALLBACK_REQUESTED',
      note: 'Spoke about the marina unit',
      durationSecs: 95,
      followUpAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ok: true, leadId: agentLeadId });
    expect(await calls(agentLeadId)).toBe(before + 1);
    const activity = await prisma.activity.findFirstOrThrow({ where: { tenantId, id: res.body.activity.id } });
    expect(activity).toMatchObject({ outcome: 'Call back later', durationSecs: 95, ownerId: agentId });
    expect(res.body.followUp.id).toBeTruthy();
  });

  it('does not log the same call twice when the queue replays it', async () => {
    const key = `offline-queue-${suffix}-1`;
    const body = { outcome: 'CONNECTED', note: 'Replayed' };
    const before = await calls(agentLeadId);
    const first = await logCall(agentToken, agentLeadId, body, key);
    const second = await logCall(agentToken, agentLeadId, body, key);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get('idempotent-replay')).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(await calls(agentLeadId)).toBe(before + 1);
  });

  it('refuses a key reused for a different call, or by a different person', async () => {
    const key = `offline-queue-${suffix}-2`;
    expect((await logCall(agentToken, agentLeadId, { outcome: 'BUSY' }, key)).status).toBe(200);
    const before = await calls(agentLeadId);
    const changed = await logCall(agentToken, agentLeadId, { outcome: 'NO_ANSWER' }, key);
    expect(changed.status).toBe(409);
    const stranger = await logCall(managerToken, agentLeadId, { outcome: 'BUSY' }, key);
    expect(stranger.status).toBe(409);
    expect(stranger.body.detail).toMatch(/someone else/);
    expect(await calls(agentLeadId)).toBe(before);
  });

  it('keeps the time the call happened, not the time it was sent', async () => {
    const happened = new Date(Date.now() - 3 * 3_600_000);
    const res = await logCall(agentToken, agentLeadId, { outcome: 'NO_ANSWER', occurredAt: happened.toISOString() });
    expect(res.status).toBe(200);
    const activity = await prisma.activity.findFirstOrThrow({ where: { tenantId, id: res.body.activity.id } });
    expect(activity.occurredAt.getTime()).toBe(happened.getTime());
  });

  it('allows a phone clock a minute fast, and refuses a call claimed in the future or over a week ago', async () => {
    const fast = await logCall(agentToken, agentLeadId, {
      outcome: 'WRONG_NUMBER',
      occurredAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(fast.status).toBe(200);

    const before = await calls(agentLeadId, 'Switched off');
    const future = await logCall(agentToken, agentLeadId, {
      outcome: 'SWITCHED_OFF',
      occurredAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(future.status).toBe(422);
    const ancient = await logCall(agentToken, agentLeadId, {
      outcome: 'SWITCHED_OFF',
      occurredAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    });
    expect(ancient.status).toBe(422);
    expect(await calls(agentLeadId, 'Switched off')).toBe(before);
  });

  it('refuses a lead outside the caller’s scope, or in another workspace, whatever the URL says', async () => {
    expect((await logCall(agentToken, adminLeadId, { outcome: 'CONNECTED' })).status).toBe(404);
    expect((await logCall(agentToken, strangerLeadId, { outcome: 'CONNECTED' })).status).toBe(404);
    expect(await calls(adminLeadId)).toBe(0);
  });
});

describe('the lead list and the follow-ups', () => {
  it('shows an OWN agent only their own leads, numbers masked; a manager every lead, numbers shown', async () => {
    const mine = await call(leadsRoute, '/api/mobile/leads', { token: agentToken });
    expect(mine.status).toBe(200);
    expect(mine.body.rows.map((row: { id: string }) => row.id)).toEqual([agentLeadId]);
    expect(mine.body.rows[0]).toMatchObject({ fullName: 'Mariam Saleh', masked: true, statusName: 'New' });
    expect(mine.body.rows[0].phone).not.toContain('9876543');

    const all = await call(leadsRoute, '/api/mobile/leads?take=50', { token: managerToken });
    const ids = all.body.rows.map((row: { id: string }) => row.id);
    expect(ids).toEqual(expect.arrayContaining([agentLeadId, ...fixture.a.leadIds]));
    expect(ids).not.toContain(strangerLeadId);
    expect(all.body.rows.find((row: { id: string }) => row.id === agentLeadId)).toMatchObject({
      phone: '+971509876543',
      masked: false,
    });
  });

  it('opens one lead by its id within scope, and pages by keyset', async () => {
    const one = await call(leadsRoute, `/api/mobile/leads?q=${agentLeadId}`, { token: agentToken });
    expect(one.body.rows.map((row: { id: string }) => row.id)).toEqual([agentLeadId]);
    const notMine = await call(leadsRoute, `/api/mobile/leads?q=${adminLeadId}`, { token: agentToken });
    expect(notMine.body.rows).toEqual([]);

    const first = await call(leadsRoute, '/api/mobile/leads?take=2', { token: managerToken });
    expect(first.body.rows).toHaveLength(2);
    expect(first.body.nextCursor).toBe(first.body.rows[1].id);
    const next = await call(leadsRoute, `/api/mobile/leads?take=2&cursor=${first.body.nextCursor}`, {
      token: managerToken,
    });
    const seen = first.body.rows.map((row: { id: string }) => row.id);
    for (const row of next.body.rows) expect(seen).not.toContain(row.id);
  });

  it('lists the caller’s own open follow-ups, overdue on the workspace clock, without a masked number', async () => {
    await prisma.followUpTask.create({
      data: {
        tenantId,
        leadId: agentLeadId,
        ownerId: agentId,
        title: 'Follow-up call',
        dueAt: new Date(Date.now() - 2 * 86_400_000),
      },
    });
    const res = await call(followUpsRoute, '/api/mobile/follow-ups', { token: agentToken });
    expect(res.status).toBe(200);
    const overdue = res.body.rows.filter((row: { overdue: boolean }) => row.overdue);
    expect(overdue).toHaveLength(1);
    expect(overdue[0].lead).toMatchObject({ id: agentLeadId, fullName: 'Mariam Saleh', phone: null, dialable: null });
    expect(res.body.rows.every((row: { lead: { id: string } }) => row.lead.id === agentLeadId)).toBe(true);
  });

  it('moves a lead through the stage rules, under the lead’s scope', async () => {
    const won = await prisma.leadStage.create({
      data: { tenantId, key: `contacted-${suffix}`, name: 'Contacted', position: 1 },
    });
    const moved = await call(statusRoute, `/api/mobile/leads/${agentLeadId}/status`, {
      token: agentToken,
      body: { statusId: won.id },
      params: { leadId: agentLeadId },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((await prisma.lead.findFirstOrThrow({ where: { tenantId, id: agentLeadId } })).stageId).toBe(won.id);
    const refused = await call(statusRoute, `/api/mobile/leads/${adminLeadId}/status`, {
      token: agentToken,
      body: { statusId: won.id },
      params: { leadId: adminLeadId },
    });
    expect(refused.status).toBe(404);
  });

  it('needs a lead module: a workspace without one is refused the leads', async () => {
    const plain = await prisma.tenant.create({
      data: { slug: `plain-${suffix}`, legalName: 'Plain LLC', displayName: 'Plain' },
    });
    try {
      await prisma.moduleEntitlement.create({ data: { tenantId: plain.id, module: 'HRMS', state: 'ACTIVE' } });
      const plainRole = await prisma.role.create({
        data: { tenantId: plain.id, key: `agent-${suffix}`, name: 'Agent', rank: 80 },
      });
      await grantPermissions(plain.id, plainRole.id, [['leads', 'VIEW']], 'ORGANIZATION');
      const user = await person('plain', plainRole.id, { tenant: plain.id });
      const token = (
        await createDeviceSession({
          platformUserId: user.platformUserId,
          tenantId: plain.id,
          deviceName: null,
          platform: null,
          ip: null,
          userAgent: null,
          mfaSatisfied: false,
        })
      ).token;
      expect((await call(leadsRoute, '/api/mobile/leads', { token })).status).toBe(403);
      expect((await me(token)).status).toBe(200);
    } finally {
      await prisma.tenant.delete({ where: { id: plain.id } }).catch(() => {});
    }
  });
});

describe('the mobile routes', () => {
  it('take the device session and nothing else, every one but sign-in', () => {
    const root = join(__dirname, '../../src/app/api/mobile');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : name === 'route.ts' ? [path] : [];
      });
    const files = walk(root).filter((file) => !/sign-in/.test(file));
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const file of files) expect(readFileSync(file, 'utf8'), file).toMatch(/\bmobile: true\b/);
  });
});
