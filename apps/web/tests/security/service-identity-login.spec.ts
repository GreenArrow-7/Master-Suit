/**
 * Interactive sign-in for the `AI_SERVICE` identity.
 *
 * The bar is the one the rest of this suite holds: **after the flow, what can
 * the caller actually do?** Not "the row says mfaEnabled" — a real TOTP code is
 * derived from the real secret and posted to the real route, and the resulting
 * session is then used against real endpoints to prove what it can and cannot
 * reach.
 *
 * The two properties that matter most, and the reason this file is long:
 *
 *   1. **MFA cannot be skipped.** Every path that could hand back a usable
 *      session without a second factor is asserted to refuse.
 *   2. **Signing in interactively buys no authority.** The session is read-only,
 *      holds no owner rights, and stays inside the identity's scopes and
 *      workspace allowlist — otherwise the browser is the way around the scoping
 *      the machine credential enforces per request.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { env } from '@/lib/env';
import { totp } from '@/lib/auth/mfa';
import { encryptSecret } from '@/services/identity/secrets';
import { issueRecoveryCodes } from '@/services/identity/twoFactor';
import { clear as clearLimit, limits } from '@/lib/security/ratelimit';
import { createPlatformSessionToken } from '../helpers/session';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { POST as serviceLogin, DELETE as serviceLogout } from '@/app/api/v1/auth/service-login/route';
import { POST as humanLogin } from '@/app/api/v1/auth/login/route';
import { GET as listLeads, POST as createLead } from '@/app/api/v1/leads/route';
import { GET as listAccounts } from '@/app/api/v1/accounts/route';

const suffix = randomBytes(4).toString('hex');
const username = `ai.reader.${suffix}`;
const email = `svc.login.${suffix}@platform.internal`;
const ownerEmail = `svc.owner.${suffix}@platform.test`;
const PASSWORD = 'ServiceLogin-Pass-2026';
/** A valid base32 secret, fixed so `totp()` here and the route agree. */
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

let fx: Fixture;
let identityId = '';
let ownerId = '';
let recoveryCodes: string[] = [];

/** The code the authenticator would be showing right now. */
const currentCode = () => totp(SECRET, Math.floor(Date.now() / 1000 / 30));

async function login(body: Record<string, unknown>, origin?: string) {
  await clearLimit(limits.serviceLogin(String(body.username ?? '')));
  await clearLimit(limits.loginPerIp('unknown'));
  const res = await serviceLogin(
    new Request('http://localhost/api/v1/auth/service-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

/**
 * A live AI_SERVICE session as a Cookie header.
 *
 * Minted through the shared helper rather than scraped from the login route's
 * response: `createPlatformSession` writes the cookie through `next/headers`,
 * which is inert outside a request scope, so there is no Set-Cookie to read. The
 * login route's own behaviour is asserted directly against the session rows it
 * creates, in the cases above.
 */
const sessionFor = (tenantId: string | null = null) =>
  createPlatformSessionToken(identityId, tenantId, { purpose: 'AI_SERVICE' });

async function callWithCookie(
   
  handler: (req: Request, ctx: { params: Promise<any> }) => Promise<Response>,
  path: string,
  cookie: string,
  options: { method?: string; body?: unknown } = {},
) {
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method: options.method ?? 'GET',
      headers: { cookie, ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    }),
    { params: Promise.resolve({}) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** A minimal owner context for the platform recovery services. */
const ownerCtx = () =>
  ({
    platformUserId: ownerId,
    platformRole: 'OWNER',
    email: ownerEmail,
    fullName: 'Recovery Owner',
    passwordChangedAt: new Date(),
    activeTenantId: null,
    sessionId: 'test-session',
    purpose: 'FULL',
    requestId: 'test-request',
    ip: null,
    userAgent: null,
  }) as const;

beforeAll(async () => {
  fx = await seedTwoTenants();
  const { codes, hashed } = issueRecoveryCodes();
  recoveryCodes = codes;

  const identity = await prisma.platformUser.create({
    data: {
      email,
      normalizedEmail: email,
      username,
      fullName: 'Platform service',
      passwordHash: await hashPassword(PASSWORD),
      passwordChangedAt: new Date(),
      status: 'ACTIVE',
      platformRole: 'AI_SERVICE',
      mfaEnabled: true,
      mfaSecret: encryptSecret(SECRET),
      mfaRecoveryCodes: hashed,
      serviceScopes: ['leads:read'],
    },
  });
  identityId = identity.id;

  const owner = await prisma.platformUser.create({
    data: {
      email: ownerEmail,
      normalizedEmail: ownerEmail,
      fullName: 'Recovery Owner',
      passwordHash: await hashPassword('OwnerPass-2026'),
      status: 'ACTIVE',
      platformRole: 'OWNER',
    },
  });
  ownerId = owner.id;
});

beforeEach(async () => {
  // Each case starts from a clean lock and throttle, so one test's lockout is
  // never the reason the next one fails.
  await prisma.platformUser
    .update({
      where: { id: identityId },
      data: { failedLoginCount: 0, lockedUntil: null, status: 'ACTIVE' },
    })
    .catch(() => {});
  await clearLimit(limits.mfaConfirm(identityId));
});

afterAll(async () => {
  await prisma.platformAuditEvent.deleteMany({ where: { actorUserId: { in: [identityId, ownerId] } } }).catch(() => {});
  await prisma.platformUser
    .deleteMany({ where: { normalizedEmail: { in: [email, ownerEmail] } } })
    .catch(() => {});
  await fx?.cleanup();
});

// ── The happy path, and the ways it must fail ──────────────────────────────

describe('username + password + MFA', () => {
  it('correct password and correct MFA signs in', async () => {
    const res = await login({ username, password: PASSWORD, mfaCode: currentCode() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.identity.username).toBe(username);
    expect(res.body.identity.platformRole).toBe('AI_SERVICE');
    expect(res.body.readOnly).toBe(true);

    const session = await prisma.platformSession.findFirst({
      where: { platformUserId: identityId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(session?.purpose).toBe('AI_SERVICE');
    expect(session?.mfaSatisfied).toBe(true);
  });

  it('correct password and WRONG MFA fails', async () => {
    const wrong = currentCode() === '000000' ? '111111' : '000000';
    const res = await login({ username, password: PASSWORD, mfaCode: wrong });
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('wrong password fails, and says nothing a correct one would not', async () => {
    const wrong = await login({ username, password: 'not-the-password', mfaCode: currentCode() });
    expect(wrong.status).toBe(401);
    const unknown = await login({ username: `nobody.${suffix}`, password: PASSWORD });
    expect(unknown.status).toBe(401);
    // Identical message for "no such account" and "wrong password".
    expect(wrong.body.detail).toBe(unknown.body.detail);
  });

  it('MFA cannot be skipped — omitting the code returns a challenge, never a session', async () => {
    const before = await prisma.platformSession.count({ where: { platformUserId: identityId } });
    const res = await login({ username, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.expiresAt).toBeUndefined();
    // The half that matters: a correct password alone created nothing to hold.
    expect(await prisma.platformSession.count({ where: { platformUserId: identityId } })).toBe(before);
  });

  it('a recovery code works once and is then spent', async () => {
    const code = recoveryCodes[0]!;
    const first = await login({ username, password: PASSWORD, recoveryCode: code });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.recoveryCodeUsed).toBe(true);

    await prisma.platformUser.update({
      where: { id: identityId },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    await clearLimit(limits.mfaConfirm(identityId));
    expect((await login({ username, password: PASSWORD, recoveryCode: code })).status).toBe(401);
  });

  it('an identity with no authenticator gets an enrolment grant, not a session', async () => {
    const bare = `svc.bare.${suffix}@platform.internal`;
    const bareName = `ai.bare.${suffix}`;
    const created = await prisma.platformUser.create({
      data: {
        email: bare,
        normalizedEmail: bare,
        username: bareName,
        fullName: 'Unenrolled service',
        passwordHash: await hashPassword(PASSWORD),
        status: 'ACTIVE',
        platformRole: 'AI_SERVICE',
      },
    });

    const res = await login({ username: bareName, password: PASSWORD, mfaCode: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.mfaEnrolmentRequired).toBe(true);

    // A restricted grant, not a signed-in session.
    const session = await prisma.platformSession.findFirst({
      where: { platformUserId: created.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(session?.purpose).toBe('MFA_ENROLMENT');
    expect(session?.mfaSatisfied).toBe(false);

    // And that grant cannot read anything.
    const grantCookie = await createPlatformSessionToken(created.id, fx.a.tenantId, {
      purpose: 'MFA_ENROLMENT',
      mfaSatisfied: false,
    });
    expect((await callWithCookie(listLeads, '/api/v1/leads', grantCookie)).status).toBe(401);

    await prisma.platformUser.delete({ where: { id: created.id } });
  });
});

// ── Account state ──────────────────────────────────────────────────────────

describe('account standing', () => {
  it('a deactivated account cannot sign in', async () => {
    await prisma.platformUser.update({ where: { id: identityId }, data: { status: 'DEACTIVATED' } });
    expect((await login({ username, password: PASSWORD, mfaCode: currentCode() })).status).toBe(401);

    await prisma.platformUser.update({ where: { id: identityId }, data: { status: 'ACTIVE' } });
    await clearLimit(limits.mfaConfirm(identityId));
    expect((await login({ username, password: PASSWORD, mfaCode: currentCode() })).status).toBe(200);
  });

  it('a locked account cannot sign in even with the right credentials', async () => {
    await prisma.platformUser.update({
      where: { id: identityId },
      data: { lockedUntil: new Date(Date.now() + 3_600_000) },
    });
    expect((await login({ username, password: PASSWORD, mfaCode: currentCode() })).status).toBe(401);
  });

  it('repeated wrong passwords lock the account, and the lockout is audited', async () => {
    // Driven off the configured threshold rather than a literal: MAX_FAILED_LOGINS
    // is 10 in this repo's .env and 5 in the schema default, and a hardcoded
    // count silently stops testing anything when the two differ.
    for (let attempt = 0; attempt < env.MAX_FAILED_LOGINS; attempt += 1) {
      await login({ username, password: `wrong-${attempt}` });
    }
    const row = await prisma.platformUser.findUnique({ where: { id: identityId } });
    expect(row?.lockedUntil).toBeTruthy();
    expect(row!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    const locked = await prisma.platformAuditEvent.findMany({
      where: { actorUserId: identityId, event: 'ACCOUNT_LOCKED' },
    });
    expect(locked.length).toBeGreaterThan(0);
  });

  it('a deactivated identity cannot use an already-issued session either', async () => {
    const cookie = await sessionFor(fx.a.tenantId);
    expect((await callWithCookie(listLeads, '/api/v1/leads', cookie)).status).toBe(200);

    await prisma.platformUser.update({ where: { id: identityId }, data: { status: 'DEACTIVATED' } });
    expect((await callWithCookie(listLeads, '/api/v1/leads', cookie)).status).toBe(401);
    await prisma.platformUser.update({ where: { id: identityId }, data: { status: 'ACTIVE' } });
  });

  it('the human login route never leaves this identity with a usable session', async () => {
    await clearLimit(limits.loginPerAccount(email));
    await clearLimit(limits.loginPerIp('unknown'));
    await humanLogin(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: PASSWORD, mfaCode: currentCode() }),
      }),
    );
    // Even if it mints one, resolvePlatformCtx refuses a FULL session for this
    // role — so what matters is that nothing usable survives.
    const full = await prisma.platformSession.findFirst({
      where: { platformUserId: identityId, purpose: 'FULL', revokedAt: null },
    });
    if (full) {
      const cookie = await createPlatformSessionToken(identityId, fx.a.tenantId, { purpose: 'FULL' });
      expect((await callWithCookie(listLeads, '/api/v1/leads', cookie)).status).toBe(401);
    }
  });
});

// ── What the session may do ────────────────────────────────────────────────

describe('the session buys no authority', () => {
  it('reads only what the identity scopes allow', async () => {
    const cookie = await sessionFor(fx.a.tenantId);
    expect((await callWithCookie(listLeads, '/api/v1/leads', cookie)).status).toBe(200);
    // accounts:read was never granted.
    expect((await callWithCookie(listAccounts, '/api/v1/accounts', cookie)).status).toBe(403);
  });

  it('still cannot write tenant data', async () => {
    const cookie = await sessionFor(fx.a.tenantId);
    const res = await callWithCookie(createLead, '/api/v1/leads', cookie, {
      method: 'POST',
      body: { fullName: 'Interactive Should Not Write', phone: '+971500000009', stageId: fx.a.stageId },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(
      await prisma.lead.findFirst({ where: { tenantId: fx.a.tenantId, fullName: 'Interactive Should Not Write' } }),
    ).toBeNull();
  });

  it('cannot gain OWNER privileges through a break-glass grant', async () => {
    await prisma.platformAccessGrant.create({
      data: {
        tenantId: fx.a.tenantId,
        platformUserId: identityId,
        reason: 'attempting to elevate an interactive service session',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const cookie = await sessionFor(fx.a.tenantId);
    const res = await callWithCookie(createLead, '/api/v1/leads', cookie, {
      method: 'POST',
      body: { fullName: 'Elevated Should Not Write', phone: '+971500000010', stageId: fx.a.stageId },
    });
    expect(res.status).toBe(403);
    await prisma.platformAccessGrant.deleteMany({ where: { platformUserId: identityId } });
  });

  it('honours the workspace allowlist', async () => {
    await prisma.platformUser.update({
      where: { id: identityId },
      data: { serviceTenantAllowlist: [fx.a.tenantId] },
    });
    const allowed = await sessionFor(fx.a.tenantId);
    const refused = await sessionFor(fx.b.tenantId);
    expect((await callWithCookie(listLeads, '/api/v1/leads', allowed)).status).toBe(200);
    expect((await callWithCookie(listLeads, '/api/v1/leads', refused)).status).toBe(403);
    await prisma.platformUser.update({ where: { id: identityId }, data: { serviceTenantAllowlist: [] } });
  });

  it('an empty scope list reads nothing at all', async () => {
    await prisma.platformUser.update({ where: { id: identityId }, data: { serviceScopes: [] } });
    const cookie = await sessionFor(fx.a.tenantId);
    expect((await callWithCookie(listLeads, '/api/v1/leads', cookie)).status).toBe(403);
    await prisma.platformUser.update({ where: { id: identityId }, data: { serviceScopes: ['leads:read'] } });
  });

  it('a FULL session for this identity is refused and revoked on sight', async () => {
    const cookie = await createPlatformSessionToken(identityId, fx.a.tenantId, { purpose: 'FULL' });
    expect((await callWithCookie(listLeads, '/api/v1/leads', cookie)).status).toBe(401);

    const row = await prisma.platformSession.findFirst({
      where: { platformUserId: identityId, purpose: 'FULL' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row?.revokedAt).toBeTruthy();
    expect(row?.revokedReason).toBe('ROLE_PURPOSE_MISMATCH');
  });

  it('an AI_SERVICE session on a human account is refused too', async () => {
    const cookie = await createPlatformSessionToken(ownerId, fx.a.tenantId, { purpose: 'AI_SERVICE' });
    expect((await callWithCookie(listLeads, '/api/v1/leads', cookie)).status).toBe(401);
  });
});

// ── Session lifecycle ──────────────────────────────────────────────────────

describe('session security', () => {
  it('the interactive session is short-lived', async () => {
    await login({ username, password: PASSWORD, mfaCode: currentCode() });
    const session = await prisma.platformSession.findFirst({
      where: { platformUserId: identityId, purpose: 'AI_SERVICE' },
      orderBy: { createdAt: 'desc' },
    });
    const minutes = (session!.expiresAt.getTime() - session!.createdAt.getTime()) / 60_000;
    // Far shorter than the eight hours a person's session runs for.
    expect(minutes).toBeLessThanOrEqual(30);
  });

  it('revoking a session stops it immediately', async () => {
    const cookie = await sessionFor(fx.a.tenantId);
    expect((await callWithCookie(listLeads, '/api/v1/leads', cookie)).status).toBe(200);

    const session = await prisma.platformSession.findFirst({
      where: { platformUserId: identityId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.platformSession.update({
      where: { id: session!.id },
      data: { revokedAt: new Date(), revokedReason: 'TEST' },
    });
    expect((await callWithCookie(listLeads, '/api/v1/leads', cookie)).status).toBe(401);
  });

  it('logout-all ends every live session', async () => {
    const cookie = await sessionFor(null);
    await sessionFor(null);
    expect(
      await prisma.platformSession.count({ where: { platformUserId: identityId, revokedAt: null } }),
    ).toBeGreaterThan(1);

    const res = await serviceLogout(
      new Request('http://localhost/api/v1/auth/service-login?all=true', {
        method: 'DELETE',
        headers: { cookie },
      }),
    );
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(await prisma.platformSession.count({ where: { platformUserId: identityId, revokedAt: null } })).toBe(0);
  });

  it('a password reset invalidates existing sessions', async () => {
    const cookie = await sessionFor(fx.a.tenantId);
    expect((await callWithCookie(listLeads, '/api/v1/leads', cookie)).status).toBe(200);

    const { resetPassword } = await import('@/services/platform/identity');
    await resetPassword(ownerCtx(), identityId, { password: 'BrandNew-Password-2026', requireChange: false });

    expect((await callWithCookie(listLeads, '/api/v1/leads', cookie)).status).toBe(401);
    await prisma.platformUser.update({
      where: { id: identityId },
      data: { passwordHash: await hashPassword(PASSWORD) },
    });
  });

  it('an MFA reset invalidates existing sessions and forces re-enrolment', async () => {
    const cookie = await sessionFor(fx.a.tenantId);
    expect((await callWithCookie(listLeads, '/api/v1/leads', cookie)).status).toBe(200);

    const { resetMfa } = await import('@/services/platform/identity');
    await resetMfa(ownerCtx(), identityId);

    expect((await callWithCookie(listLeads, '/api/v1/leads', cookie)).status).toBe(401);
    const row = await prisma.platformUser.findUnique({ where: { id: identityId } });
    expect(row?.mfaEnabled).toBe(false);
    expect(row?.mfaSecret).toBeNull();
    expect(row?.mfaRecoveryCodes).toEqual([]);

    // Restored for the remaining cases.
    const { hashed } = issueRecoveryCodes();
    await prisma.platformUser.update({
      where: { id: identityId },
      data: { mfaEnabled: true, mfaSecret: encryptSecret(SECRET), mfaRecoveryCodes: hashed },
    });
  });

  it('refuses a cross-origin sign-in attempt', async () => {
    const res = await login({ username, password: PASSWORD, mfaCode: currentCode() }, 'https://evil.example.com');
    expect(res.status).toBe(403);
  });
});

// ── The invariants the whole design rests on ───────────────────────────────

describe('platform-level, and audited', () => {
  it('signing in creates no WorkspaceMembership and no workspace user', async () => {
    await login({ username, password: PASSWORD, mfaCode: currentCode() });
    expect(await prisma.workspaceMembership.count({ where: { platformUserId: identityId } })).toBe(0);
    for (const tenantId of [fx.a.tenantId, fx.b.tenantId]) {
      expect(await prisma.user.count({ where: { tenantId, email } })).toBe(0);
    }
  });

  it('writes successes and failures to the protected platform log', async () => {
    await login({ username, password: 'wrong-on-purpose' });
    await prisma.platformUser.update({ where: { id: identityId }, data: { failedLoginCount: 0, lockedUntil: null } });
    await login({ username, password: PASSWORD, mfaCode: currentCode() });

    const events = await prisma.platformAuditEvent.findMany({ where: { actorUserId: identityId } });
    const names = new Set(events.map((row) => row.event));
    expect(names.has('LOGIN')).toBe(true);
    expect(names.has('LOGIN_FAILED')).toBe(true);
    // Platform authentication is not an act inside a customer's workspace.
    expect(events.every((row) => row.tenantId === null)).toBe(true);
  });

  it('never writes a password, secret, recovery code or token into the audit trail', async () => {
    const serialised = JSON.stringify(await prisma.platformAuditEvent.findMany({ where: { actorUserId: identityId } }));
    expect(serialised).not.toContain(PASSWORD);
    expect(serialised).not.toContain(SECRET);
    for (const code of recoveryCodes) expect(serialised).not.toContain(code);
    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('mfaSecret');
  });
});
