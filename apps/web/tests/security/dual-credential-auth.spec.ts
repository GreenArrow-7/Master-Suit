/**
 * One platform identity, two passwords, and the session each one produces.
 *
 * Everything here signs in the way a person does — email, password, then the
 * authenticator code against the server's challenge — and then uses the exact
 * session token the login route issued. `next/headers` is replaced with a jar
 * so the route's own cookie write can be read back; nothing mints a session
 * behind the route's back except the legacy-session cases, which exist to prove
 * what a session *without* a credential purpose is refused.
 *
 * All identities, workspaces and records are synthetic and tagged with a random
 * suffix. No real account or credential appears anywhere in this file.
 */
import { createHash, randomBytes } from 'node:crypto';
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
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { generateSecret, totp } from '@/lib/auth/mfa';
import { encryptSecret } from '@/services/identity/secrets';
import { clear as clearLimit, limits } from '@/lib/security/ratelimit';
import { resolveCtx, resolvePlatformCtx, SESSION_COOKIE } from '@/lib/auth/session';
import { requirePlatformOwner, requirePlatformSupport } from '@/lib/auth/platform';
import { changeOwnPassword } from '@/services/identity/accounts';
import { resetMfa } from '@/services/platform/identity';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { POST as refresh } from '@/app/api/v1/auth/refresh/route';
import { POST as resetPasswordRoute } from '@/app/api/v1/auth/reset-password/route';
import { POST as enroll2fa } from '@/app/api/v1/auth/enroll-2fa/route';
import { POST as switchWorkspace } from '@/app/api/v1/auth/workspaces/route';
import { GET as credentialsGet, POST as credentialsPost } from '@/app/api/v1/platform/credentials/route';
import { POST as grantMonitoring, DELETE as revokeMonitoring } from '@/app/api/v1/platform/monitoring/grants/route';
import { POST as createWorkspace } from '@/app/api/v1/platform/workspaces/route';
import { POST as openBreakGlass } from '@/app/api/v1/platform/workspaces/[workspaceId]/access/route';
import { POST as enterWorkspace } from '@/app/api/v1/platform/workspaces/[workspaceId]/enter/route';
import { POST as userActions } from '@/app/api/v1/platform/users/[userId]/actions/route';
import { GET as listLeads, POST as createLead } from '@/app/api/v1/leads/route';
import { GET as exportLeads } from '@/app/api/v1/leads/export/route';
import { GET as readTranscript } from '@/app/api/v1/calls/[id]/transcript/route';
import { GET as hrRead } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route';
import { POST as selfService } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/self/[action]/route';
import { grantPermissions } from '../helpers/fixtures';
import { freshTotp } from '../helpers/totp';
import { buildCtx, buildActor } from '../helpers/ctx';

const suffix = randomBytes(4).toString('hex');
const PASSWORD_A = `Administration-${suffix}-Pass1`;
const PASSWORD_B = `Monitoring-${suffix}-Pass2`;
const OTHER_PASSWORD = `Unrelated-${suffix}-Pass3`;
const SECRET = generateSecret();
const OWNER2_SECRET = generateSecret();
const LEAD_NAME = `DualCredLead-${suffix}`;
const TRANSCRIPT_TEXT = `DualCredTranscript-${suffix} the client said something private`;

const ownerEmail = `dual.${suffix}@platform.test`;
const owner2Email = `second.${suffix}@platform.test`;
const enrolEmail = `enrol.${suffix}@platform.test`;
const memberEmail = `member.${suffix}@customer.test`;

let granted = { id: '', slug: '' };
let ungranted = { id: '', slug: '' };
let ownerId = '';
let owner2Id = '';
let enrolId = '';
let memberPlatformId = '';
let memberUserId = '';
let callId = '';

const code = (secret = SECRET) => totp(secret, Math.floor(Date.now() / 1000 / 30));
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const cookieOf = (token: string) => `${SESSION_COOKIE}=${token}`;

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
  jar.clear();
  const res = await login(request('http://localhost/api/v1/auth/login', 'POST', body));
  const json = await res.json().catch(() => null);
  const token = jar.get(SESSION_COOKIE) ?? null;
  jar.clear();
  return { status: res.status, json, token };
}

async function freshLimits(email: string) {
  await clearLimit(limits.loginPerIp('unknown'));
  await clearLimit(limits.loginPerAccount(email));
  await clearLimit(limits.mfaConfirm(ownerId));
}

/** Password, then the challenge, exactly as the login form does it. */
async function signIn(email: string, password: string, secret = SECRET) {
  await freshLimits(email);
  const first = await callLogin({ email, password });
  expect(first.status, JSON.stringify(first.json)).toBe(200);
  expect(first.token).toBeNull();
  expect(first.json.mfaRequired).toBe(true);
  const second = await callLogin({ challenge: first.json.challenge, mfaCode: await freshTotp({ email }, secret) });
  expect(second.status, JSON.stringify(second.json)).toBe(200);
  expect(second.token).toBeTruthy();
  return { token: second.token!, cookie: cookieOf(second.token!), body: second.json };
}

const sessionRow = (token: string) => prisma.platformSession.findUnique({ where: { tokenHash: sha256(token) } });

async function makeWorkspace(name: string, modules: ('SALES' | 'HRMS')[]) {
  const tenant = await prisma.tenant.create({
    data: { slug: `${name}-${suffix}`, legalName: `${name} LLC`, displayName: `${name} Co`, status: 'ACTIVE' },
  });
  for (const productModule of modules) {
    await prisma.moduleEntitlement.create({ data: { tenantId: tenant.id, module: productModule, state: 'ACTIVE' } });
  }
  return { id: tenant.id, slug: tenant.slug };
}

async function staffIdentity(
  email: string,
  platformRole: 'OWNER' | 'SUPPORT',
  password: string,
  secret: string | null,
) {
  return prisma.platformUser.create({
    data: {
      email,
      normalizedEmail: email,
      fullName: `Staff ${suffix}`,
      passwordHash: await hashPassword(password),
      status: 'ACTIVE',
      platformRole,
      passwordChangedAt: new Date(),
      ...(secret ? { mfaEnabled: true, mfaSecret: encryptSecret(secret) } : {}),
    },
  });
}

beforeAll(async () => {
  granted = await makeWorkspace('dualg', ['SALES', 'HRMS']);
  ungranted = await makeWorkspace('dualu', ['SALES']);

  ownerId = (await staffIdentity(ownerEmail, 'OWNER', PASSWORD_A, SECRET)).id;
  owner2Id = (await staffIdentity(owner2Email, 'OWNER', OTHER_PASSWORD, OWNER2_SECRET)).id;
  enrolId = (await staffIdentity(enrolEmail, 'OWNER', OTHER_PASSWORD, null)).id;

  // The owner is ALSO a full administrator of the granted workspace — the case
  // where a monitoring session must not borrow the membership's authority.
  const adminRole = await prisma.role.create({
    data: { tenantId: granted.id, key: `dualadmin-${suffix}`, name: 'Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  await grantPermissions(granted.id, adminRole.id, [
    ['leads', 'VIEW'],
    ['leads', 'CREATE'],
    ['leads', 'EDIT'],
    ['calls', 'VIEW'],
    ['employee', 'VIEW'],
    ['leads', 'EXPORT'],
    ['identity_self', 'VIEW'],
  ]);
  const ownerAsMember = await prisma.user.create({
    data: {
      tenantId: granted.id,
      email: ownerEmail,
      fullName: 'Owner as member',
      roleId: adminRole.id,
      status: 'ACTIVE',
    },
  });
  await prisma.workspaceMembership.create({
    data: {
      tenantId: granted.id,
      platformUserId: ownerId,
      salesUserId: ownerAsMember.id,
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });

  // An ordinary customer member, for "customer sign-in is unchanged".
  const member = await prisma.platformUser.create({
    data: {
      email: memberEmail,
      normalizedEmail: memberEmail,
      fullName: 'Customer member',
      passwordHash: await hashPassword(OTHER_PASSWORD),
      status: 'ACTIVE',
      passwordChangedAt: new Date(),
    },
  });
  memberPlatformId = member.id;
  const memberUser = await prisma.user.create({
    data: {
      tenantId: granted.id,
      email: memberEmail,
      fullName: 'Customer member',
      roleId: adminRole.id,
      status: 'ACTIVE',
    },
  });
  memberUserId = memberUser.id;
  await prisma.workspaceMembership.create({
    data: {
      tenantId: granted.id,
      platformUserId: member.id,
      salesUserId: memberUser.id,
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });

  const stage = await prisma.leadStage.create({
    data: { tenantId: granted.id, key: `new-${suffix}`, name: 'New', position: 1 },
  });
  await prisma.lead.create({
    data: { tenantId: granted.id, reference: `L-${suffix}`, fullName: LEAD_NAME, stageId: stage.id },
  });
  const call = await prisma.call.create({ data: { tenantId: granted.id, callerId: memberUser.id } });
  callId = call.id;
  await prisma.transcript.create({ data: { tenantId: granted.id, callId, content: TRANSCRIPT_TEXT } });

  // Monitoring access to the granted workspace, issued by a second owner.
  await prisma.platformAccessGrant.create({
    data: {
      platformUserId: ownerId,
      tenantId: granted.id,
      kind: 'READ',
      sensitive: false,
      reason: 'Second owner authorises monitoring for the dual-credential suite',
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  jar.clear();
});

afterAll(async () => {
  for (const id of [granted.id, ungranted.id]) await prisma.tenant.delete({ where: { id } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { contains: suffix } } }).catch(() => {});
  for (const email of [ownerEmail, owner2Email, enrolEmail, memberEmail]) {
    await clearLimit(limits.loginPerAccount(email)).catch(() => {});
  }
  await clearLimit(limits.loginPerIp('unknown')).catch(() => {});
});

// ── Provisioning ─────────────────────────────────────────────────────────────

describe('setting the monitoring password', () => {
  it('is refused without fresh re-authentication, even from an administration session', async () => {
    const admin = await signIn(ownerEmail, PASSWORD_A);
    const res = await credentialsPost(
      request(
        'http://localhost/api/v1/platform/credentials',
        'POST',
        {
          action: 'set-monitoring',
          currentPassword: 'not-the-password-9A',
          mfaCode: await freshTotp({ id: ownerId }, SECRET),
          newPassword: PASSWORD_B,
        },
        admin.cookie,
      ),
    );
    expect(res.status).toBe(403);
    const row = await prisma.platformUser.findUnique({
      where: { id: ownerId },
      select: { monitoringPasswordHash: true },
    });
    expect(row!.monitoringPasswordHash).toBeNull();
  });

  it('refuses the administration password as the monitoring password', async () => {
    const admin = await signIn(ownerEmail, PASSWORD_A);
    const res = await credentialsPost(
      request(
        'http://localhost/api/v1/platform/credentials',
        'POST',
        {
          action: 'set-monitoring',
          currentPassword: PASSWORD_A,
          mfaCode: await freshTotp({ id: ownerId }, SECRET),
          newPassword: PASSWORD_A,
        },
        admin.cookie,
      ),
    );
    expect(res.status).toBe(409);
  });

  it('refuses a retired administration password as the monitoring password', async () => {
    // The reuse window the administration password keeps applies to this one too: a
    // password the person has already retired is a known secret, not a second one.
    const retired = `Retired-${suffix}-Pass7`;
    await prisma.passwordHistory.create({
      data: { platformUserId: ownerId, passwordHash: await hashPassword(retired) },
    });
    const admin = await signIn(ownerEmail, PASSWORD_A);
    await clearLimit(limits.mfaConfirm(ownerId));
    const res = await credentialsPost(
      request(
        'http://localhost/api/v1/platform/credentials',
        'POST',
        {
          action: 'set-monitoring',
          currentPassword: PASSWORD_A,
          mfaCode: await freshTotp({ id: ownerId }, SECRET),
          newPassword: retired,
        },
        admin.cookie,
      ),
    );
    expect(res.status, await res.clone().text()).toBe(409);
    const row = await prisma.platformUser.findUnique({
      where: { id: ownerId },
      select: { monitoringPasswordHash: true },
    });
    expect(row!.monitoringPasswordHash).toBeNull();
  });

  it('sets it, stores only an independent salted hash, and audits without any secret', async () => {
    const admin = await signIn(ownerEmail, PASSWORD_A);
    await clearLimit(limits.mfaConfirm(ownerId));
    const res = await credentialsPost(
      request(
        'http://localhost/api/v1/platform/credentials',
        'POST',
        {
          action: 'set-monitoring',
          currentPassword: PASSWORD_A,
          mfaCode: await freshTotp({ id: ownerId }, SECRET),
          newPassword: PASSWORD_B,
        },
        admin.cookie,
      ),
    );
    expect(res.status, await res.clone().text()).toBe(200);

    const row = await prisma.platformUser.findUnique({ where: { id: ownerId } });
    expect(row!.monitoringPasswordHash).toMatch(/^\$argon2id\$/);
    expect(row!.monitoringPasswordHash).not.toBe(row!.passwordHash);
    expect(await verifyPassword(row!.monitoringPasswordHash!, PASSWORD_B)).toBe(true);
    expect(await verifyPassword(row!.monitoringPasswordHash!, PASSWORD_A)).toBe(false);
    expect(row!.monitoringPasswordVersion).toBe(1);

    const audit = await prisma.platformAuditEvent.findFirst({
      where: { objectId: ownerId, event: 'MONITORING_CREDENTIAL_SET' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    const serialised = JSON.stringify(audit);
    for (const secret of [PASSWORD_A, PASSWORD_B, SECRET, row!.monitoringPasswordHash!, row!.passwordHash!]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('is not readable back: the status endpoint says whether, never what', async () => {
    const admin = await signIn(ownerEmail, PASSWORD_A);
    const res = await credentialsGet(
      request('http://localhost/api/v1/platform/credentials', 'GET', undefined, admin.cookie),
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text).hasMonitoringCredential).toBe(true);
    expect(text).not.toContain('argon2');
  });
});

// ── Login and MFA ────────────────────────────────────────────────────────────

describe('same email, two passwords', () => {
  it('password A + MFA → administration session, sent to the console', async () => {
    const admin = await signIn(ownerEmail, PASSWORD_A);
    expect(admin.body.destination).toBe('/platform');
    const row = await sessionRow(admin.token);
    expect(row!.credentialPurpose).toBe('PLATFORM_ADMIN');
    expect(row!.mfaSatisfied).toBe(true);
    await expect(
      requirePlatformOwner(request('http://internal/', 'GET', undefined, admin.cookie), 'r'),
    ).resolves.toMatchObject({
      credentialPurpose: 'PLATFORM_ADMIN',
    });
  });

  it('password B + MFA → monitoring session, sent to /monitoring, refused by the console', async () => {
    const monitor = await signIn(ownerEmail, PASSWORD_B);
    expect(monitor.body.destination).toBe('/monitoring');
    expect(monitor.body.workspaces).toEqual([]);
    const row = await sessionRow(monitor.token);
    expect(row!.credentialPurpose).toBe('MONITORING');
    expect(row!.activeTenantId).toBeNull();
    await expect(
      requirePlatformOwner(request('http://internal/', 'GET', undefined, monitor.cookie), 'r'),
    ).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      requirePlatformSupport(request('http://internal/', 'GET', undefined, monitor.cookie), 'r'),
    ).resolves.toMatchObject({
      credentialPurpose: 'MONITORING',
    });
  });

  it('a password alone issues no session and says nothing about which password it was', async () => {
    for (const password of [PASSWORD_A, PASSWORD_B]) {
      await freshLimits(ownerEmail);
      const res = await callLogin({ email: ownerEmail, password });
      expect(res.status).toBe(200);
      expect(res.token).toBeNull();
      expect(Object.keys(res.json).sort()).toEqual(['challenge', 'challengeExpiresAt', 'mfaRequired']);
    }
  });

  it('a wrong MFA code issues nothing, for either password', async () => {
    for (const password of [PASSWORD_A, PASSWORD_B]) {
      await freshLimits(ownerEmail);
      const first = await callLogin({ email: ownerEmail, password });
      const wrong = await callLogin({
        challenge: first.json.challenge,
        mfaCode: code() === '000000' ? '111111' : '000000',
      });
      expect(wrong.status).toBe(401);
      expect(wrong.token).toBeNull();
    }
  });

  it('a wrong password and an unknown email get the same answer', async () => {
    await freshLimits(ownerEmail);
    const wrong = await callLogin({ email: ownerEmail, password: 'Wrong-password-123' });
    await freshLimits(`nobody.${suffix}@platform.test`);
    const unknown = await callLogin({ email: `nobody.${suffix}@platform.test`, password: 'Wrong-password-123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json.detail).toBe(unknown.json.detail);
    await prisma.platformUser.update({ where: { id: ownerId }, data: { failedLoginCount: 0 } });
  });

  it('refuses a client-supplied mode outright rather than ignoring it', async () => {
    await freshLimits(ownerEmail);
    const res = await callLogin({ email: ownerEmail, password: PASSWORD_B, mode: 'PLATFORM_ADMIN' });
    expect(res.status).toBe(422);
    expect(res.token).toBeNull();
  });

  it('the one-request form reaches the same result through the same challenge', async () => {
    await freshLimits(ownerEmail);
    const res = await callLogin({
      email: ownerEmail,
      password: PASSWORD_B,
      mfaCode: await freshTotp({ id: ownerId }, SECRET),
    });
    expect(res.status).toBe(200);
    expect((await sessionRow(res.token!))!.credentialPurpose).toBe('MONITORING');
  });

  it('a challenge is single use', async () => {
    await freshLimits(ownerEmail);
    const first = await callLogin({ email: ownerEmail, password: PASSWORD_A });
    const ok = await callLogin({ challenge: first.json.challenge, mfaCode: await freshTotp({ id: ownerId }, SECRET) });
    expect(ok.status).toBe(200);
    await freshLimits(ownerEmail);
    const replay = await callLogin({ challenge: first.json.challenge, mfaCode: code() });
    expect(replay.status).toBe(401);
    expect(replay.token).toBeNull();
  });
});

// ── Enrolment-only, ambiguity, identical passwords ───────────────────────────

describe('enrolment-only sessions and invalid credential data', () => {
  it('an enrolment-only session reaches no console, no monitoring and no credential management', async () => {
    await freshLimits(enrolEmail);
    const res = await callLogin({ email: enrolEmail, password: OTHER_PASSWORD });
    expect(res.json.mfaEnrolmentRequired).toBe(true);
    const cookie = cookieOf(res.token!);
    expect((await sessionRow(res.token!))!.purpose).toBe('MFA_ENROLMENT');
    await expect(
      requirePlatformOwner(request('http://internal/', 'GET', undefined, cookie), 'r'),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      requirePlatformSupport(request('http://internal/', 'GET', undefined, cookie), 'r'),
    ).rejects.toMatchObject({ status: 401 });
    const creds = await credentialsGet(
      request('http://localhost/api/v1/platform/credentials', 'GET', undefined, cookie),
    );
    expect(creds.status).toBe(401);
    jar.set(SESSION_COOKIE, res.token!);
    const rotated = await refresh(request('http://localhost/api/v1/auth/refresh', 'POST', undefined, cookie));
    expect(rotated.status).toBe(401);
  });

  it('a monitoring password on an identity without an enrolled factor signs in nowhere', async () => {
    await prisma.platformUser.update({
      where: { id: enrolId },
      data: { monitoringPasswordHash: await hashPassword(PASSWORD_B) },
    });
    await freshLimits(enrolEmail);
    const res = await callLogin({ email: enrolEmail, password: PASSWORD_B });
    expect(res.status).toBe(401);
    expect(res.token).toBeNull();
    await prisma.platformUser.update({ where: { id: enrolId }, data: { monitoringPasswordHash: null } });
  });

  it('both slots accepting one password fails closed and records a security event', async () => {
    const before = await prisma.platformUser.findUnique({
      where: { id: ownerId },
      select: { monitoringPasswordHash: true },
    });
    await prisma.platformUser.update({
      where: { id: ownerId },
      data: { monitoringPasswordHash: await hashPassword(PASSWORD_A) },
    });
    try {
      await freshLimits(ownerEmail);
      const res = await callLogin({ email: ownerEmail, password: PASSWORD_A });
      expect(res.status).toBe(401);
      expect(res.json.challenge).toBeUndefined();
      const event = await prisma.platformAuditEvent.findFirst({
        where: { objectId: ownerId, event: 'LOGIN_CREDENTIAL_AMBIGUOUS' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(event).toBeTruthy();
    } finally {
      await prisma.platformUser.update({
        where: { id: ownerId },
        data: { monitoringPasswordHash: before!.monitoringPasswordHash },
      });
    }
  });

  it('refuses making the administration password equal to the monitoring password, by every writer', async () => {
    const admin = await signIn(ownerEmail, PASSWORD_A);
    await clearLimit(limits.mfaConfirm(ownerId));
    const viaConsole = await credentialsPost(
      request(
        'http://localhost/api/v1/platform/credentials',
        'POST',
        {
          action: 'change-admin-password',
          currentPassword: PASSWORD_A,
          mfaCode: await freshTotp({ id: ownerId }, SECRET),
          newPassword: PASSWORD_B,
        },
        admin.cookie,
      ),
    );
    expect(viaConsole.status).toBe(409);

    // From a workspace screen, as the member the owner also is.
    const memberRow = await prisma.workspaceMembership.findFirst({
      where: { platformUserId: ownerId, tenantId: granted.id },
    });
    const ctx = buildCtx(
      buildActor({
        id: memberRow!.salesUserId!,
        tenantId: granted.id,
        roleId: 'x',
        roleKey: 'admin',
        roleRank: 10,
        permissions: new Map(),
      }),
    );
    await expect(changeOwnPassword(ctx, PASSWORD_A, PASSWORD_B)).rejects.toMatchObject({ status: 409 });

    // Through an emailed reset link issued for the administration credential.
    const token = randomBytes(32).toString('base64url');
    await prisma.passwordResetToken.create({
      data: {
        platformUserId: ownerId,
        tenantId: null,
        tokenHash: sha256(token),
        credentialPurpose: 'PLATFORM_ADMIN',
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const viaReset = await resetPasswordRoute(
      request('http://localhost/api/v1/auth/reset-password', 'POST', { token, newPassword: PASSWORD_B }),
    );
    expect(viaReset.status).toBe(409);

    const row = await prisma.platformUser.findUnique({ where: { id: ownerId } });
    expect(await verifyPassword(row!.passwordHash!, PASSWORD_A)).toBe(true);
  });

  it('a reset link naming the monitoring credential, or no purpose, is refused for staff', async () => {
    for (const credentialPurpose of ['MONITORING', null] as const) {
      const token = randomBytes(32).toString('base64url');
      await prisma.passwordResetToken.create({
        data: {
          platformUserId: ownerId,
          tenantId: null,
          tokenHash: sha256(token),
          credentialPurpose,
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
      const res = await resetPasswordRoute(
        request('http://localhost/api/v1/auth/reset-password', 'POST', {
          token,
          newPassword: `Brand-new-${suffix}-Pass9`,
        }),
      );
      expect(res.status).toBe(401);
    }
  });
});

// ── Monitoring stays monitoring ──────────────────────────────────────────────

describe('a monitoring session for an OWNER who is also a workspace admin and holds a WRITE grant', () => {
  let monitorCookie = '';
  let adminCookie = '';

  beforeAll(async () => {
    const admin = await signIn(ownerEmail, PASSWORD_A);
    adminCookie = admin.cookie;
    // Break-glass on the granted workspace AND on the ungranted one.
    for (const workspace of [granted, ungranted]) {
      const res = await openBreakGlass(
        request(
          `http://localhost/api/v1/platform/workspaces/${workspace.id}/access`,
          'POST',
          {
            reason: 'Repairing records at the customer written request',
          },
          adminCookie,
        ),
        { params: Promise.resolve({ workspaceId: workspace.id }) },
      );
      expect(res.status, await res.clone().text()).toBeLessThan(300);
    }
    const monitor = await signIn(ownerEmail, PASSWORD_B);
    monitorCookie = monitor.cookie;
  });

  const enter = (workspaceId: string, cookie: string) =>
    enterWorkspace(
      request(`http://localhost/api/v1/platform/workspaces/${workspaceId}/enter`, 'POST', undefined, cookie),
      {
        params: Promise.resolve({ workspaceId }),
      },
    );

  it('a WRITE grant does not admit it where no READ grant exists', async () => {
    expect((await enter(ungranted.id, monitorCookie)).status).toBe(404);
    // The same identity's administration session is admitted by that break-glass.
    expect((await enter(ungranted.id, adminCookie)).status).toBe(200);
  });

  it('enters the granted workspace, reads, and is refused every write', async () => {
    expect((await enter(granted.id, monitorCookie)).status).toBe(200);
    const read = await listLeads(request('http://localhost/api/v1/leads', 'GET', undefined, monitorCookie), {
      params: Promise.resolve({}),
    });
    expect(read.status).toBe(200);
    expect(await read.text()).toContain(LEAD_NAME);

    const write = await createLead(
      request('http://localhost/api/v1/leads', 'POST', { fullName: 'Nope', phone: '+971500000001' }, monitorCookie),
      { params: Promise.resolve({}) },
    );
    expect(write.status).toBe(403);
  });

  it('never gets the membership actor or break-glass, on any request', async () => {
    const ctx = await resolveCtx(request('http://internal/', 'GET', undefined, monitorCookie), 'r');
    expect(ctx.actor.id.startsWith('platform:')).toBe(true);
    expect(ctx.actor.platformMode).toBe('monitoring');
    expect(ctx.actor.credentialPurpose).toBe('MONITORING');
    expect(ctx.actor.permissions.has('leads:CREATE')).toBe(false);
  });

  it('is refused HR, the transcript (the WRITE grant is sensitive, the READ grant is not), and account settings', async () => {
    const hr = await hrRead(
      request(`http://localhost/api/v1/workspaces/${granted.slug}/hr/employees`, 'GET', undefined, monitorCookie),
      {
        params: Promise.resolve({ workspaceSlug: granted.slug, resource: 'employees' }),
      },
    );
    expect(hr.status).toBe(403);
    const transcript = await readTranscript(
      request(`http://localhost/api/v1/calls/${callId}/transcript`, 'GET', undefined, monitorCookie),
      {
        params: Promise.resolve({ id: callId }),
      },
    );
    expect(transcript.status).toBe(403);
    expect(await transcript.text()).not.toContain(TRANSCRIPT_TEXT);
    const password = await selfService(
      request(
        `http://localhost/api/v1/workspaces/${granted.slug}/identity/self/password-change`,
        'POST',
        {
          currentPassword: PASSWORD_A,
          newPassword: `Changed-${suffix}-Pass7`,
        },
        monitorCookie,
      ),
      { params: Promise.resolve({ workspaceSlug: granted.slug, action: 'password-change' }) },
    );
    expect(password.status).toBe(403);
  });

  it('is refused the lead export that the same person is allowed as a workspace admin', async () => {
    // Positive control: the customer member holds the same role, EXPORT included.
    await freshLimits(memberEmail);
    const member = await callLogin({ email: memberEmail, password: OTHER_PASSWORD });
    const allowed = await exportLeads(
      request('http://localhost/api/v1/leads/export', 'GET', undefined, cookieOf(member.token!)),
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain(LEAD_NAME);

    const refused = await exportLeads(request('http://localhost/api/v1/leads/export', 'GET', undefined, monitorCookie));
    expect(refused.status).toBe(403);
    expect(await refused.text()).not.toContain(LEAD_NAME);
  });

  it('is refused every administration API, workspace creation, grants, break-glass and credential management', async () => {
    const attempts: [string, Promise<Response>][] = [
      [
        'grant',
        grantMonitoring(
          request(
            'http://localhost/api/v1/platform/monitoring/grants',
            'POST',
            {
              platformUserId: owner2Id,
              workspaceId: granted.id,
              reason: 'Issuing from a monitoring session',
            },
            monitorCookie,
          ),
        ),
      ],
      [
        'revoke grant',
        revokeMonitoring(
          request(
            'http://localhost/api/v1/platform/monitoring/grants',
            'DELETE',
            {
              platformUserId: ownerId,
              workspaceId: granted.id,
            },
            monitorCookie,
          ),
        ),
      ],
      [
        'create workspace',
        createWorkspace(
          request(
            'http://localhost/api/v1/platform/workspaces',
            'POST',
            {
              slug: `never-${suffix}`,
              displayName: 'Never',
              legalName: 'Never LLC',
            },
            monitorCookie,
          ),
        ),
      ],
      [
        'break-glass',
        openBreakGlass(
          request(
            `http://localhost/api/v1/platform/workspaces/${granted.id}/access`,
            'POST',
            {
              reason: 'Elevating from a monitoring session',
            },
            monitorCookie,
          ),
          { params: Promise.resolve({ workspaceId: granted.id }) },
        ),
      ],
      [
        'user action',
        userActions(
          request(
            `http://localhost/api/v1/platform/users/${owner2Id}/actions`,
            'POST',
            {
              action: 'unlock',
            },
            monitorCookie,
          ),
          { params: Promise.resolve({ userId: owner2Id }) },
        ),
      ],
      [
        'credentials read',
        credentialsGet(request('http://localhost/api/v1/platform/credentials', 'GET', undefined, monitorCookie)),
      ],
      [
        'credentials write',
        credentialsPost(
          request(
            'http://localhost/api/v1/platform/credentials',
            'POST',
            {
              action: 'revoke-monitoring',
              currentPassword: PASSWORD_A,
              mfaCode: code(),
            },
            monitorCookie,
          ),
        ),
      ],
      [
        'two-factor',
        enroll2fa(request('http://localhost/api/v1/auth/enroll-2fa', 'POST', { step: 'begin' }, monitorCookie)),
      ],
      [
        'membership switch',
        switchWorkspace(
          request('http://localhost/api/v1/auth/workspaces', 'POST', { workspaceId: granted.id }, monitorCookie),
        ),
      ],
    ];
    for (const [label, pending] of attempts) {
      const res = await pending;
      expect(res.status, label).toBe(403);
    }
    expect(await prisma.tenant.count({ where: { slug: `never-${suffix}` } })).toBe(0);
    expect((await prisma.platformUser.findUnique({ where: { id: ownerId } }))!.monitoringPasswordHash).not.toBeNull();
  });

  it('records its reads and refusals with the credential that proved it', async () => {
    const rows = await prisma.platformAuditEvent.findMany({
      where: { tenantId: granted.id, actorUserId: ownerId, event: 'SUPPORT_READ' },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    });
    const monitoringRows = rows.filter(
      (row) => (row.metadata as { credentialPurpose?: string }).credentialPurpose === 'MONITORING',
    );
    expect(monitoringRows.length).toBeGreaterThan(0);
    expect(monitoringRows.some((row) => (row.metadata as { status?: number }).status === 403)).toBe(true);
    expect(monitoringRows.every((row) => (row.metadata as { mode?: string }).mode === 'monitoring')).toBe(true);
  });

  it('a read cannot outlive its audit row', async () => {
    const original = prisma.platformAuditEvent.create.bind(prisma.platformAuditEvent);
    vi.spyOn(prisma.platformAuditEvent, 'create').mockImplementation(((args: Parameters<typeof original>[0]) => {
      if ((args.data as { event?: string }).event === 'SUPPORT_READ')
        return Promise.reject(new Error('audit store unavailable')) as never;
      return original(args);
    }) as never);
    const read = await listLeads(request('http://localhost/api/v1/leads', 'GET', undefined, monitorCookie), {
      params: Promise.resolve({}),
    });
    expect(read.status).toBeGreaterThanOrEqual(500);
    expect(await read.text()).not.toContain(LEAD_NAME);
  });
});

// ── Grants during a live session ─────────────────────────────────────────────

describe('workspace grants change under a live monitoring session', () => {
  it('revocation and expiry take effect on the next request', async () => {
    const monitor = await signIn(ownerEmail, PASSWORD_B);
    const enter = await enterWorkspace(
      request(`http://localhost/api/v1/platform/workspaces/${granted.id}/enter`, 'POST', undefined, monitor.cookie),
      { params: Promise.resolve({ workspaceId: granted.id }) },
    );
    expect(enter.status).toBe(200);
    const read = () =>
      listLeads(request('http://localhost/api/v1/leads', 'GET', undefined, monitor.cookie), {
        params: Promise.resolve({}),
      });
    expect((await read()).status).toBe(200);

    await prisma.platformAccessGrant.updateMany({
      where: { platformUserId: ownerId, tenantId: granted.id, kind: 'READ' },
      data: { revokedAt: new Date() },
    });
    expect((await read()).status).toBe(403);

    const renewed = await prisma.platformAccessGrant.create({
      data: {
        platformUserId: ownerId,
        tenantId: granted.id,
        kind: 'READ',
        reason: 'Renewed for the expiry case of this suite',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    expect((await read()).status).toBe(200);
    await prisma.platformAccessGrant.updateMany({
      where: { id: renewed.id, tenantId: granted.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await read()).status).toBe(403);

    await prisma.platformAccessGrant.create({
      data: {
        platformUserId: ownerId,
        tenantId: granted.id,
        kind: 'READ',
        reason: 'Restored for the remaining cases of this suite',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
  });

  it('a sensitive READ grant opens the transcript to monitoring, and removing it closes it again', async () => {
    const grant = await prisma.platformAccessGrant.create({
      data: {
        platformUserId: ownerId,
        tenantId: granted.id,
        kind: 'READ',
        sensitive: true,
        reason: 'Reviewing a disputed call for this suite',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const monitor = await signIn(ownerEmail, PASSWORD_B);
    await enterWorkspace(
      request(`http://localhost/api/v1/platform/workspaces/${granted.id}/enter`, 'POST', undefined, monitor.cookie),
      {
        params: Promise.resolve({ workspaceId: granted.id }),
      },
    );
    const read = () =>
      readTranscript(request(`http://localhost/api/v1/calls/${callId}/transcript`, 'GET', undefined, monitor.cookie), {
        params: Promise.resolve({ id: callId }),
      });
    const open = await read();
    expect(open.status).toBe(200);
    expect(await open.text()).toContain(TRANSCRIPT_TEXT);
    await prisma.platformAccessGrant.updateMany({
      where: { id: grant.id, tenantId: granted.id },
      data: { revokedAt: new Date() },
    });
    const closed = await read();
    expect(closed.status).toBe(403);
  });
});

// ── Rate limiting ────────────────────────────────────────────────────────────

describe('combined rate limiting', () => {
  it('attempts against either password spend one per-account allowance', async () => {
    await freshLimits(ownerEmail);
    const outcomes: number[] = [];
    // Five wrong guesses, alternating the slot the guess resembles.
    for (let i = 0; i < 5; i++) {
      outcomes.push(
        (await callLogin({ email: ownerEmail, password: i % 2 ? `${PASSWORD_B}x` : `${PASSWORD_A}x` })).status,
      );
    }
    // The sixth is refused before any credential is checked — even the right one.
    const sixth = await callLogin({ email: ownerEmail, password: PASSWORD_B });
    expect(outcomes).toEqual([401, 401, 401, 401, 401]);
    expect(sixth.status).toBe(429);
    await prisma.platformUser.update({ where: { id: ownerId }, data: { failedLoginCount: 0, lockedUntil: null } });
    await freshLimits(ownerEmail);
  });
});

// ── Credential lifecycle ─────────────────────────────────────────────────────

describe('changing and revoking credentials', () => {
  it('changing the monitoring password ends its sessions and challenges — even a row whose revocation was lost', async () => {
    const admin = await signIn(ownerEmail, PASSWORD_A);
    const monitor = await signIn(ownerEmail, PASSWORD_B);
    await freshLimits(ownerEmail);
    const pending = await callLogin({ email: ownerEmail, password: PASSWORD_B });

    await clearLimit(limits.mfaConfirm(ownerId));
    const NEW_B = `${PASSWORD_B}-v2`;
    const res = await credentialsPost(
      request(
        'http://localhost/api/v1/platform/credentials',
        'POST',
        {
          action: 'set-monitoring',
          currentPassword: PASSWORD_A,
          mfaCode: await freshTotp({ id: ownerId }, SECRET),
          newPassword: NEW_B,
        },
        admin.cookie,
      ),
    );
    expect(res.status, await res.clone().text()).toBe(200);

    // Simulate a lost revocation write: the version still refuses it.
    await prisma.platformSession.update({
      where: { tokenHash: sha256(monitor.token) },
      data: { revokedAt: null, revokedReason: null },
    });
    await expect(
      resolvePlatformCtx(request('http://internal/', 'GET', undefined, monitor.cookie), 'r'),
    ).rejects.toMatchObject({ status: 401 });
    expect((await sessionRow(monitor.token))!.revokedReason).toBe('CREDENTIAL_CHANGED');

    await freshLimits(ownerEmail);
    const stale = await callLogin({ challenge: pending.json.challenge, mfaCode: code() });
    expect(stale.status).toBe(401);
    expect(stale.token).toBeNull();

    // The administration session is untouched.
    await expect(
      requirePlatformOwner(request('http://internal/', 'GET', undefined, admin.cookie), 'r'),
    ).resolves.toBeTruthy();

    // Put B back for the cases below.
    await clearLimit(limits.mfaConfirm(ownerId));
    const back = await credentialsPost(
      request(
        'http://localhost/api/v1/platform/credentials',
        'POST',
        {
          action: 'set-monitoring',
          currentPassword: PASSWORD_A,
          mfaCode: await freshTotp({ id: ownerId }, SECRET),
          newPassword: PASSWORD_B,
        },
        admin.cookie,
      ),
    );
    expect(back.status).toBe(200);
  });

  it('revoking the monitoring password ends monitoring without touching the administration password', async () => {
    const admin = await signIn(ownerEmail, PASSWORD_A);
    const monitor = await signIn(ownerEmail, PASSWORD_B);
    const before = await prisma.platformUser.findUnique({
      where: { id: ownerId },
      select: { passwordHash: true, passwordVersion: true },
    });

    // Another owner revokes it, with their own authenticator code.
    const owner2 = await signIn(owner2Email, OTHER_PASSWORD, OWNER2_SECRET);
    await clearLimit(limits.mfaConfirm(owner2Id));
    const res = await userActions(
      request(
        `http://localhost/api/v1/platform/users/${ownerId}/actions`,
        'POST',
        {
          action: 'revoke-monitoring-credential',
          mfaCode: await freshTotp({ id: owner2Id }, OWNER2_SECRET),
        },
        owner2.cookie,
      ),
      { params: Promise.resolve({ userId: ownerId }) },
    );
    expect(res.status, await res.clone().text()).toBe(200);

    await expect(
      resolvePlatformCtx(request('http://internal/', 'GET', undefined, monitor.cookie), 'r'),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      requirePlatformOwner(request('http://internal/', 'GET', undefined, admin.cookie), 'r'),
    ).resolves.toBeTruthy();
    const after = await prisma.platformUser.findUnique({
      where: { id: ownerId },
      select: { passwordHash: true, passwordVersion: true },
    });
    expect(after).toEqual(before);

    await freshLimits(ownerEmail);
    expect((await callLogin({ email: ownerEmail, password: PASSWORD_B })).status).toBe(401);

    // Restore for later cases.
    await clearLimit(limits.mfaConfirm(ownerId));
    const restored = await credentialsPost(
      request(
        'http://localhost/api/v1/platform/credentials',
        'POST',
        {
          action: 'set-monitoring',
          currentPassword: PASSWORD_A,
          mfaCode: await freshTotp({ id: ownerId }, SECRET),
          newPassword: PASSWORD_B,
        },
        admin.cookie,
      ),
    );
    expect(restored.status).toBe(200);
  });

  it('an MFA reset ends both modes and every unfinished sign-in', async () => {
    const admin = await signIn(ownerEmail, PASSWORD_A);
    const monitor = await signIn(ownerEmail, PASSWORD_B);
    await freshLimits(ownerEmail);
    const pending = await callLogin({ email: ownerEmail, password: PASSWORD_A });

    const owner2Ctx = await resolvePlatformCtx(
      request('http://internal/', 'GET', undefined, (await signIn(owner2Email, OTHER_PASSWORD, OWNER2_SECRET)).cookie),
      'r',
    );
    await resetMfa(owner2Ctx, ownerId);

    for (const cookie of [admin.cookie, monitor.cookie]) {
      await expect(
        resolvePlatformCtx(request('http://internal/', 'GET', undefined, cookie), 'r'),
      ).rejects.toMatchObject({ status: 401 });
    }
    await freshLimits(ownerEmail);
    expect((await callLogin({ challenge: pending.json.challenge, mfaCode: code() })).status).toBe(401);
    await freshLimits(ownerEmail);
    expect((await callLogin({ email: ownerEmail, password: PASSWORD_B })).status).toBe(401);

    // Re-enrol the same secret for the cases below.
    await prisma.platformUser.update({
      where: { id: ownerId },
      data: { mfaEnabled: true, mfaSecret: encryptSecret(SECRET) },
    });
  });

  it('disabling the account refuses both modes', async () => {
    const admin = await signIn(ownerEmail, PASSWORD_A);
    const monitor = await signIn(ownerEmail, PASSWORD_B);
    await prisma.platformUser.update({ where: { id: ownerId }, data: { status: 'SUSPENDED' } });
    try {
      for (const cookie of [admin.cookie, monitor.cookie]) {
        await expect(
          resolvePlatformCtx(request('http://internal/', 'GET', undefined, cookie), 'r'),
        ).rejects.toMatchObject({ status: 401 });
      }
      for (const password of [PASSWORD_A, PASSWORD_B]) {
        await freshLimits(ownerEmail);
        expect((await callLogin({ email: ownerEmail, password })).status).toBe(401);
      }
    } finally {
      await prisma.platformUser.update({ where: { id: ownerId }, data: { status: 'ACTIVE' } });
    }
  });
});

// ── Separate sessions ────────────────────────────────────────────────────────

describe('separate sessions keep their own mode', () => {
  it('signing in with the other password creates a new session and changes neither existing one', async () => {
    const admin = await signIn(ownerEmail, PASSWORD_A);
    const monitor = await signIn(ownerEmail, PASSWORD_B);
    await signIn(ownerEmail, PASSWORD_A);
    await signIn(ownerEmail, PASSWORD_B);
    expect((await sessionRow(admin.token))!.credentialPurpose).toBe('PLATFORM_ADMIN');
    expect((await sessionRow(monitor.token))!.credentialPurpose).toBe('MONITORING');
    await expect(
      requirePlatformOwner(request('http://internal/', 'GET', undefined, monitor.cookie), 'r'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      requirePlatformOwner(request('http://internal/', 'GET', undefined, admin.cookie), 'r'),
    ).resolves.toBeTruthy();
  });

  it('refreshing a monitoring session keeps it a monitoring session', async () => {
    const monitor = await signIn(ownerEmail, PASSWORD_B);
    jar.set(SESSION_COOKIE, monitor.token);
    const res = await refresh(request('http://localhost/api/v1/auth/refresh', 'POST', undefined, monitor.cookie));
    expect(res.status).toBe(200);
    const rotated = jar.get(SESSION_COOKIE)!;
    expect(rotated).not.toBe(monitor.token);
    expect((await sessionRow(rotated))!.credentialPurpose).toBe('MONITORING');
    await expect(
      requirePlatformOwner(request('http://internal/', 'GET', undefined, cookieOf(rotated)), 'r'),
    ).rejects.toMatchObject({ status: 403 });
  });
});

// ── Unchanged: customers and legacy sessions ─────────────────────────────────

describe('customer sign-in and legacy sessions', () => {
  it('an ordinary customer signs in exactly as before, with no credential purpose', async () => {
    await freshLimits(memberEmail);
    const res = await callLogin({ email: memberEmail, password: OTHER_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.json.destination).toBe(`/${granted.slug}/dashboard`);
    const row = await sessionRow(res.token!);
    expect(row!.credentialPurpose).toBeNull();
    const ctx = await resolveCtx(request('http://internal/', 'GET', undefined, cookieOf(res.token!)), 'r');
    expect(ctx.actor.id).toBe(memberUserId);
  });

  it('a staff session with no credential purpose is refused and revoked; a customer one is not', async () => {
    const legacyToken = randomBytes(32).toString('base64url');
    await prisma.platformSession.create({
      data: {
        platformUserId: ownerId,
        tokenHash: sha256(legacyToken),
        mfaSatisfied: true,
        purpose: 'FULL',
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    await expect(
      resolvePlatformCtx(request('http://internal/', 'GET', undefined, cookieOf(legacyToken)), 'r'),
    ).rejects.toMatchObject({ status: 401 });
    expect((await sessionRow(legacyToken))!.revokedReason).toBe('LEGACY_SESSION_WITHOUT_CREDENTIAL_PURPOSE');

    const customerToken = randomBytes(32).toString('base64url');
    await prisma.platformSession.create({
      data: {
        platformUserId: memberPlatformId,
        activeTenantId: granted.id,
        tokenHash: sha256(customerToken),
        mfaSatisfied: false,
        purpose: 'FULL',
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    await expect(
      resolveCtx(request('http://internal/', 'GET', undefined, cookieOf(customerToken)), 'r'),
    ).resolves.toBeTruthy();
  });
});

// ── Last, because it replaces password A for good ────────────────────────────

describe('an emailed reset of the administration password', () => {
  it('sets A, ends every session in both modes, and leaves the monitoring password working', async () => {
    const admin = await signIn(ownerEmail, PASSWORD_A);
    const monitor = await signIn(ownerEmail, PASSWORD_B);
    const NEW_A = `Reset-${suffix}-Admin4`;
    const token = randomBytes(32).toString('base64url');
    await prisma.passwordResetToken.create({
      data: {
        platformUserId: ownerId,
        tenantId: null,
        tokenHash: sha256(token),
        credentialPurpose: 'PLATFORM_ADMIN',
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const res = await resetPasswordRoute(
      request('http://localhost/api/v1/auth/reset-password', 'POST', { token, newPassword: NEW_A }),
    );
    expect(res.status, await res.clone().text()).toBe(200);

    for (const cookie of [admin.cookie, monitor.cookie]) {
      await expect(
        resolvePlatformCtx(request('http://internal/', 'GET', undefined, cookie), 'r'),
      ).rejects.toMatchObject({
        status: 401,
      });
    }
    // Single use.
    const again = await resetPasswordRoute(
      request('http://localhost/api/v1/auth/reset-password', 'POST', { token, newPassword: `${NEW_A}x` }),
    );
    expect(again.status).toBe(401);

    await freshLimits(ownerEmail);
    expect((await callLogin({ email: ownerEmail, password: PASSWORD_A })).status).toBe(401);
    const newAdmin = await signIn(ownerEmail, NEW_A);
    expect((await sessionRow(newAdmin.token))!.credentialPurpose).toBe('PLATFORM_ADMIN');
    const newMonitor = await signIn(ownerEmail, PASSWORD_B);
    expect((await sessionRow(newMonitor.token))!.credentialPurpose).toBe('MONITORING');

    const audit = await prisma.platformAuditEvent.findFirst({
      where: { objectId: ownerId, event: 'PASSWORD_RESET' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).not.toContain(token);
    expect(JSON.stringify(audit)).not.toContain(NEW_A);
  });
});
