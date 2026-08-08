import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '@/lib/auth/password';

/**
 * Session rotation, replay and logout, against a running server.
 *
 * Like `unified-saas.spec.ts` this drives a real server, so it reads the
 * database that server is connected to rather than the isolated test one.
 */
const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString:
      process.env.E2E_DATABASE_URL ?? 'postgresql://leadflow:leadflow@localhost:5432/leadflow?schema=public',
  }),
});

const suffix = Date.now().toString(36);
const email = `session.${suffix}@manathhomes.ae`;
const password = `Session-${suffix}-Secure!42`;
let platformUserId = '';

beforeAll(async () => {
  const tenant = await prisma.tenant.findFirst({ where: { slug: 'manath-homes' } });
  const role = await prisma.role.findFirst({ where: { tenantId: tenant!.id, key: 'org_admin' } });
  const passwordHash = await hashPassword(password);

  const platformUser = await prisma.platformUser.create({
    data: {
      email,
      normalizedEmail: email,
      fullName: `Session ${suffix}`,
      passwordHash,
      emailVerifiedAt: new Date(),
      status: 'ACTIVE',
    },
  });
  platformUserId = platformUser.id;
  const user = await prisma.user.create({
    data: {
      tenantId: tenant!.id,
      email,
      fullName: `Session ${suffix}`,
      emailVerifiedAt: new Date(),
      status: 'ACTIVE',
      roleId: role!.id,
    },
  });
  await prisma.workspaceMembership.create({
    data: {
      tenantId: tenant!.id,
      platformUserId: platformUser.id,
      salesUserId: user.id,
      status: 'ACTIVE',
      roleSnapshot: 'org_admin',
      joinedAt: new Date(),
    },
  });
});

afterAll(async () => {
  await prisma.platformAuditEvent.deleteMany({ where: { actorUserId: platformUserId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { id: platformUserId } }).catch(() => {});
  await prisma.$disconnect();
});

const liveSessions = () => prisma.platformSession.count({ where: { platformUserId, revokedAt: null } });
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const tokenOf = (cookie: string) => decodeURIComponent(cookie.split('=').slice(1).join('='));

/**
 * Login is throttled to 5 attempts per account per 15 minutes, and this spec
 * signs in eight times on purpose — it is exercising session lifecycle, not the
 * limiter, which `security/` covers separately. The counter is cleared before
 * each sign-in so the limiter cannot make these results depend on how recently
 * the suite last ran.
 */
async function clearLoginLimits() {
  const redis = new Redis(process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/0');
  const keys = await redis.keys('rl:login:*');
  if (keys.length) await redis.del(...keys);
  await redis.quit();
}

async function login(): Promise<string> {
  await clearLoginLimits();
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

async function call(path: string, method: string, cookie: string) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { cookie } });
  return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null };
}

describe.sequential('session lifecycle', () => {
  it('rotates the token and revokes the previous one', async () => {
    const first = await login();
    const refreshed = await call('/api/v1/auth/refresh', 'POST', first);

    expect(refreshed.status).toBe(200);
    expect(refreshed.cookie).not.toBe(first);

    const previous = await prisma.platformSession.findUnique({
      where: { tokenHash: sha256(tokenOf(first)) },
      select: { revokedAt: true, revokedReason: true },
    });
    expect(previous?.revokedAt).not.toBeNull();
    expect(previous?.revokedReason).toBe('ROTATED');

    // The new token works in its place.
    expect((await call('/api/v1/auth/workspaces', 'GET', refreshed.cookie!)).status).toBe(200);
  });

  it('refuses an expired session and does not issue a token for it', async () => {
    const cookie = await login();
    await prisma.platformSession.updateMany({
      where: { tokenHash: sha256(tokenOf(cookie)) },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const refreshed = await call('/api/v1/auth/refresh', 'POST', cookie);
    expect(refreshed.status).toBe(401);
    expect((await call('/api/v1/auth/workspaces', 'GET', cookie)).status).toBe(401);
  });

  it('treats replay of a rotated token as theft and revokes every session', async () => {
    const deviceA = await login();
    await login(); // a second, innocent device
    expect(await liveSessions()).toBeGreaterThanOrEqual(2);

    const rotated = await call('/api/v1/auth/refresh', 'POST', deviceA);
    expect(rotated.status).toBe(200);

    // Presenting the already-rotated token again.
    const replay = await call('/api/v1/auth/refresh', 'POST', deviceA);
    expect(replay.status).toBe(401);

    // Everything for this account goes, including the device that did nothing
    // wrong: there is no way to tell which party is the attacker.
    expect(await liveSessions()).toBe(0);

    const recorded = await prisma.platformAuditEvent.findFirst({
      where: { actorUserId: platformUserId, metadata: { path: ['reason'], equals: 'ROTATED_TOKEN_REPLAYED' } },
    });
    expect(recorded).not.toBeNull();
  });

  it('signs out every device on logout-all, including the caller', async () => {
    const deviceA = await login();
    const deviceB = await login();
    expect(await liveSessions()).toBe(2);

    expect((await call('/api/v1/auth/logout-all', 'POST', deviceA)).status).toBe(200);

    expect(await liveSessions()).toBe(0);
    expect((await call('/api/v1/auth/workspaces', 'GET', deviceA)).status).toBe(401);
    expect((await call('/api/v1/auth/workspaces', 'GET', deviceB)).status).toBe(401);
  });

  it('leaves other devices signed in on an ordinary logout', async () => {
    const deviceA = await login();
    const deviceB = await login();

    expect((await call('/api/v1/auth/logout', 'POST', deviceA)).status).toBe(200);

    expect((await call('/api/v1/auth/workspaces', 'GET', deviceA)).status).toBe(401);
    expect((await call('/api/v1/auth/workspaces', 'GET', deviceB)).status).toBe(200);
  });
});
