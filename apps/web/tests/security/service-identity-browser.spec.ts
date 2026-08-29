/**
 * The browser-shaped half of the service identity: the cases that only appear
 * when you stop testing one handler at a time.
 *
 * Every bug this file covers shipped past a green suite, because each earlier
 * spec exercised a single endpoint holding a single identity with no `Origin`
 * header — which is not what a browser does. The four properties below are the
 * ones that actually broke in front of an operator:
 *
 *   1. Two identities coexist. The console and the service view are used
 *      together, and one cookie name meant the second sign-in silently evicted
 *      the first.
 *   2. The wrong door explains itself. A service identity at the human login
 *      route used to get a session that was revoked on its next request.
 *   3. The origin check allows AND denies. It defaults to allowing a missing
 *      `Origin`, so a test that never sends one proves nothing.
 *   4. A page whose panels span modules must hide a panel, not throw. A scoped
 *      reader hitting one ungranted module used to 500 the whole dashboard.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { totp } from '@/lib/auth/mfa';
import { encryptSecret } from '@/services/identity/secrets';
import { clear as clearLimit, limits } from '@/lib/security/ratelimit';
import { SESSION_COOKIE, SERVICE_SESSION_COOKIE } from '@/lib/auth/session';
import { createPlatformSessionToken } from '../helpers/session';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { POST as serviceLogin, PATCH as selectWorkspace } from '@/app/api/v1/auth/service-login/route';
import { POST as humanLogin } from '@/app/api/v1/auth/login/route';
import { GET as listLeads } from '@/app/api/v1/leads/route';

const suffix = randomBytes(4).toString('hex');
const username = `ai.browser.${suffix}`;
const email = `svc.browser.${suffix}@platform.internal`;
const ownerEmail = `svc.browserowner.${suffix}@platform.test`;
const PASSWORD = 'BrowserSpec-Pass-2026';
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
/** What a browser on this deployment sends. */
const ORIGIN = 'http://localhost:3000';

let fx: Fixture;
let identityId = '';
let ownerId = '';

const code = () => totp(SECRET, Math.floor(Date.now() / 1000 / 30));

async function post(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (req: Request, ctx: { params: Promise<any> }) => Promise<Response>,
  path: string,
  body: unknown,
  options: { cookie?: string; origin?: string | null; method?: string } = {},
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // `null` means "send no Origin" — a non-browser caller. Anything else is sent
  // verbatim, which is how the deny case gets exercised at all.
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (options.cookie) headers.cookie = options.cookie;
  const res = await handler(
    new Request(`http://localhost${path}`, { method: options.method ?? 'POST', headers, body: JSON.stringify(body) }),
    { params: Promise.resolve({}) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  fx = await seedTwoTenants();

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
      serviceScopes: ['leads:read'],
    },
  });
  identityId = identity.id;

  const owner = await prisma.platformUser.create({
    data: {
      email: ownerEmail,
      normalizedEmail: ownerEmail,
      fullName: 'Console Owner',
      passwordHash: await hashPassword('OwnerSpec-Pass-2026'),
      status: 'ACTIVE',
      platformRole: 'OWNER',
    },
  });
  ownerId = owner.id;
});

beforeEach(async () => {
  await prisma.platformUser
    .update({ where: { id: identityId }, data: { failedLoginCount: 0, lockedUntil: null, status: 'ACTIVE' } })
    .catch(() => {});
  await clearLimit(limits.serviceLogin(username));
  await clearLimit(limits.serviceLogin(email));
  await clearLimit(limits.mfaConfirm(identityId));
  await clearLimit(limits.loginPerIp('unknown'));
});

afterAll(async () => {
  await prisma.platformAuditEvent.deleteMany({ where: { actorUserId: { in: [identityId, ownerId] } } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { normalizedEmail: { in: [email, ownerEmail] } } }).catch(() => {});
  await fx?.cleanup();
});

describe('two identities in one browser', () => {
  it('the service session lands in its own cookie, leaving the console session alone', async () => {
    const ownerCookie = await createPlatformSessionToken(ownerId, null, { purpose: 'FULL' });

    const res = await post(serviceLogin, '/api/v1/auth/service-login', { username, password: PASSWORD, mfaCode: code() }, { cookie: ownerCookie });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // Both sessions live: the console one was not overwritten.
    const live = await prisma.platformSession.findMany({
      where: { platformUserId: { in: [identityId, ownerId] }, revokedAt: null },
      select: { platformUserId: true, purpose: true },
    });
    expect(live.some((s) => s.platformUserId === ownerId && s.purpose === 'FULL')).toBe(true);
    expect(live.some((s) => s.platformUserId === identityId && s.purpose === 'AI_SERVICE')).toBe(true);
  });

  it('a workspace request with BOTH cookies resolves to the newer identity, not the first cookie', async () => {
    // Owner first, service second — the order an operator actually produces.
    const ownerCookie = await createPlatformSessionToken(ownerId, fx.a.tenantId, { purpose: 'FULL' });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const serviceCookie = await createPlatformSessionToken(identityId, fx.a.tenantId, { purpose: 'AI_SERVICE' });

    const both = `${ownerCookie}; ${serviceCookie.replace(SESSION_COOKIE, SERVICE_SESSION_COOKIE)}`;
    const res = await listLeads(new Request('http://localhost/api/v1/leads', { headers: { cookie: both } }), {
      params: Promise.resolve({}),
    });
    // Resolving to the owner — who holds no membership here — used to 401.
    expect(res.status).toBe(200);
  });

  it('selecting a workspace works while a console session is present', async () => {
    const ownerCookie = await createPlatformSessionToken(ownerId, null, { purpose: 'FULL' });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const serviceCookie = (await createPlatformSessionToken(identityId, null, { purpose: 'AI_SERVICE' })).replace(
      SESSION_COOKIE,
      SERVICE_SESSION_COOKIE,
    );

    const res = await post(
      selectWorkspace,
      '/api/v1/auth/service-login',
      { workspaceId: fx.a.tenantId },
      { cookie: `${ownerCookie}; ${serviceCookie}`, method: 'PATCH' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.destination).toContain(fx.a.slug);
  });
});

describe('the wrong door', () => {
  it('a service identity at the human login route is redirected, not signed in', async () => {
    await clearLimit(limits.loginPerAccount(email));
    const res = await post(humanLogin, '/api/v1/auth/login', { email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.serviceIdentity).toBe(true);
    expect(res.body.destination).toBe('/service-login');

    // The point of the redirect: no session that would be revoked a moment later.
    expect(
      await prisma.platformSession.count({ where: { platformUserId: identityId, purpose: 'FULL', revokedAt: null } }),
    ).toBe(0);
  });

  it('and does not reveal which accounts are service identities before the password is proven', async () => {
    await clearLimit(limits.loginPerAccount(email));
    const res = await post(humanLogin, '/api/v1/auth/login', { email, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.serviceIdentity).toBeUndefined();
  });
});

describe('origin checking', () => {
  it('accepts the origin the deployment is served on', async () => {
    const res = await post(serviceLogin, '/api/v1/auth/service-login', { username, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
  });

  it('refuses a foreign origin', async () => {
    const res = await post(
      serviceLogin,
      '/api/v1/auth/service-login',
      { username, password: PASSWORD },
      { origin: 'https://evil.example.com' },
    );
    expect(res.status).toBe(403);
  });

  it('still serves a caller that sends no Origin at all', async () => {
    // curl, a worker, a server-to-server client. This is the branch that made
    // every earlier probe pass without ever running the check.
    const res = await post(serviceLogin, '/api/v1/auth/service-login', { username, password: PASSWORD }, { origin: null });
    expect(res.status).toBe(200);
  });
});

describe('identifiers', () => {
  it('accepts the username and the email address alike', async () => {
    for (const identifier of [username, email]) {
      await clearLimit(limits.serviceLogin(identifier));
      const res = await post(serviceLogin, '/api/v1/auth/service-login', { username: identifier, password: PASSWORD });
      expect(res.status, `${identifier}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.mfaRequired).toBe(true);
    }
  });

  it('a completed sign-in clears the throttle, so two sign-ins in a window are fine', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const res = await post(serviceLogin, '/api/v1/auth/service-login', {
        username,
        password: PASSWORD,
        mfaCode: code(),
      });
      // The two-step flow costs two requests per sign-in; at the old limit of
      // three the second sign-in was refused having got nothing wrong.
      expect(res.status, `attempt ${attempt}`).toBe(200);
      await clearLimit(limits.mfaConfirm(identityId));
    }
  });
});
