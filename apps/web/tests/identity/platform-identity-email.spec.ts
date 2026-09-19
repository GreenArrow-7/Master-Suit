import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The operator tool that changes a platform identity's sign-in address —
 * scripts/platform-identity-email.mjs — rehearsed end to end on a synthetic
 * identity, the way it would be run against a real one.
 *
 * It is run as the child process it is, against this suite's database, and the
 * result is checked from two sides: what the row says, and what the real login
 * route does with the old and the new address, for both passwords, with the
 * authenticator still enrolled.
 */
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
}));

import { prisma, withPlatformTx } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { generateSecret } from '@/lib/auth/mfa';
import { encryptSecret } from '@/services/identity/secrets';
import { clear as clearLimit, limits } from '@/lib/security/ratelimit';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { freshTotp } from '../helpers/totp';

const SCRIPT = path.join(process.cwd(), 'scripts', 'platform-identity-email.mjs');
const suffix = randomBytes(4).toString('hex');
const OLD = `owner.${suffix}@rehearsal.test`;
const NEW = `renamed.${suffix}@rehearsal.test`;
const PASSWORD_A = `Administration-${suffix}-Pass1`;
const PASSWORD_B = `Monitoring-${suffix}-Pass2`;
const SECRET = generateSecret();
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

let fixture: Fixture;
let id = '';
let salesUserId = '';

function run(args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });
  return { code: result.status, out: `${result.stdout}\n${result.stderr}` };
}

async function callLogin(body: Record<string, unknown>) {
  jar.clear();
  const res = await login(
    new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const json = await res.json().catch(() => null);
  const token = jar.get(SESSION_COOKIE) ?? null;
  jar.clear();
  return { status: res.status, json, token };
}

async function freshLimits(email: string) {
  await clearLimit(limits.loginPerIp('unknown'));
  await clearLimit(limits.loginPerAccount(email));
}

/** Signs in through the real route with the given password and a fresh code; returns the session row. */
async function signIn(email: string, password: string) {
  await freshLimits(email);
  const first = await callLogin({ email, password });
  expect(first.status, JSON.stringify(first.json)).toBe(200);
  expect(first.json.mfaRequired).toBe(true);
  const second = await callLogin({ challenge: first.json.challenge, mfaCode: await freshTotp({ id }, SECRET) });
  expect(second.status, JSON.stringify(second.json)).toBe(200);
  expect(second.token).toBeTruthy();
  return prisma.platformSession.findUniqueOrThrow({ where: { tokenHash: sha256(second.token!) } });
}

const identity = () =>
  prisma.platformUser.findUniqueOrThrow({
    where: { id },
    select: {
      email: true,
      normalizedEmail: true,
      emailVerifiedAt: true,
      platformRole: true,
      status: true,
      mfaEnabled: true,
      deletedAt: true,
      passwordHash: true,
      monitoringPasswordHash: true,
      passwordVersion: true,
      monitoringPasswordVersion: true,
      mfaSecret: true,
    },
  });

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const user = await prisma.platformUser.create({
    data: {
      email: OLD,
      normalizedEmail: OLD,
      fullName: `Rehearsal ${suffix}`,
      passwordHash: await hashPassword(PASSWORD_A),
      monitoringPasswordHash: await hashPassword(PASSWORD_B),
      monitoringPasswordSetAt: new Date(),
      platformRole: 'OWNER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      passwordChangedAt: new Date(),
      mfaEnabled: true,
      mfaSecret: encryptSecret(SECRET),
    },
  });
  id = user.id;
  // A workspace membership whose user row carries the same address.
  const role = await prisma.role.findFirstOrThrow({
    where: { tenantId: fixture.a.tenantId },
    orderBy: { rank: 'asc' },
  });
  const sales = await prisma.user.create({
    data: {
      tenantId: fixture.a.tenantId,
      email: OLD,
      fullName: `Rehearsal ${suffix}`,
      roleId: role.id,
      status: 'ACTIVE',
    },
  });
  salesUserId = sales.id;
  await prisma.workspaceMembership.create({
    data: { tenantId: fixture.a.tenantId, platformUserId: id, salesUserId, status: 'ACTIVE', joinedAt: new Date() },
  });
  // What the change must retire, and what it must leave alone.
  const later = new Date(Date.now() + 3_600_000);
  await prisma.platformSession.create({
    data: {
      platformUserId: id,
      tokenHash: sha256(`s-${suffix}`),
      credentialPurpose: 'PLATFORM_ADMIN',
      expiresAt: later,
    },
  });
  await prisma.platformMfaChallenge.create({
    data: { platformUserId: id, tokenHash: sha256(`c-${suffix}`), credentialVersion: 0, expiresAt: later },
  });
  // `tenantId: null` said explicitly: a platform-level token, and the guard refuses a
  // create that leaves the column unmentioned.
  await prisma.passwordResetToken.create({
    data: { platformUserId: id, tenantId: null, tokenHash: sha256(`r-${suffix}`), expiresAt: later },
  });
  await prisma.platformAccessGrant.create({
    data: { tenantId: fixture.b.tenantId, platformUserId: id, reason: 'rehearsal', expiresAt: later },
  });
});

afterAll(async () => {
  await prisma.platformAuditEvent
    .deleteMany({ where: { event: 'IDENTITY_EMAIL_CHANGED', metadata: { path: ['platformUserId'], equals: id } } })
    .catch(() => {});
  if (id) await prisma.platformUser.delete({ where: { id } }).catch(() => {});
  await prisma.platformUser
    .deleteMany({ where: { normalizedEmail: `decoy.${suffix}@rehearsal.test` } })
    .catch(() => {});
  await fixture.cleanup();
});

describe('platform-identity-email.mjs', () => {
  it('dry-runs by default and writes nothing', async () => {
    const { code, out } = run(['--from', OLD, '--to', NEW]);
    expect(out).toContain('DRY RUN');
    expect(out).toContain(`"id":"${id}"`);
    expect(out).not.toMatch(/\$argon2|passwordHash|mfaSecret/);
    expect(code).toBe(0);
    expect((await identity()).email).toBe(OLD);
  });

  it('stops on a wrong --expect-id, a missing source and an occupied destination', async () => {
    expect(run(['--from', OLD, '--to', NEW, '--expect-id', 'not-the-id', '--reason', 'r', '--apply']).code).toBe(3);
    expect(run(['--from', `nobody.${suffix}@rehearsal.test`, '--to', NEW]).code).toBe(3);
    const decoy = await prisma.platformUser.create({
      data: { email: NEW, normalizedEmail: NEW, fullName: 'Decoy', status: 'ACTIVE' },
    });
    const occupied = run(['--from', OLD, '--to', NEW, '--expect-id', id, '--reason', 'r', '--apply']);
    expect(occupied.code).toBe(3);
    expect(occupied.out).toContain('already used');
    await prisma.platformUser.delete({ where: { id: decoy.id } });
    expect((await identity()).email).toBe(OLD);
    expect(await prisma.platformUser.count({ where: { normalizedEmail: NEW } })).toBe(0);
  });

  it('changes the address and only the address, retires what was bound to it, and audits it', async () => {
    const before = await identity();
    const { code, out } = run([
      '--from',
      OLD,
      '--to',
      NEW,
      '--expect-id',
      id,
      '--reason',
      `rehearsal ${suffix}`,
      '--apply',
    ]);
    expect(out, out).toContain('APPLIED');
    expect(out).not.toMatch(/\$argon2|passwordHash|mfaSecret/);
    expect(code).toBe(0);

    const after = await identity();
    expect(after.email).toBe(NEW);
    expect(after.normalizedEmail).toBe(NEW);
    expect(after.emailVerifiedAt).toBeNull();
    // Everything else is as it was: role, status, both hashes and versions, the authenticator.
    expect({
      ...after,
      email: before.email,
      normalizedEmail: before.normalizedEmail,
      emailVerifiedAt: before.emailVerifiedAt,
    }).toEqual(before);
    expect(
      (await prisma.user.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, id: salesUserId } })).email,
    ).toBe(NEW);
    expect(await prisma.workspaceMembership.count({ where: { platformUserId: id, status: 'ACTIVE' } })).toBe(1);
    // Grants sit under row-level security: a plain read answers 0 whatever the table holds.
    expect(
      await withPlatformTx((tx) => tx.platformAccessGrant.count({ where: { platformUserId: id, revokedAt: null } })),
    ).toBe(1);

    const session = await prisma.platformSession.findUniqueOrThrow({ where: { tokenHash: sha256(`s-${suffix}`) } });
    expect(session.revokedAt).not.toBeNull();
    expect(session.revokedReason).toBe('EMAIL_CHANGED');
    expect(await prisma.platformMfaChallenge.count({ where: { platformUserId: id, consumedAt: null } })).toBe(0);
    expect(
      (await prisma.passwordResetToken.findUniqueOrThrow({ where: { tokenHash: sha256(`r-${suffix}`) } })).usedAt,
    ).not.toBeNull();

    const audit = await prisma.platformAuditEvent.findMany({
      where: { event: 'IDENTITY_EMAIL_CHANGED', metadata: { path: ['platformUserId'], equals: id } },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ from: OLD, to: NEW, reason: `rehearsal ${suffix}`, sessionsRevoked: 1 });
  });

  it('the old address no longer signs in; the new one takes both passwords with the same authenticator', async () => {
    await freshLimits(OLD);
    const old = await callLogin({ email: OLD, password: PASSWORD_A });
    expect(old.status).toBe(401);
    expect(old.token).toBeNull();

    const admin = await signIn(NEW, PASSWORD_A);
    expect(admin.credentialPurpose).toBe('PLATFORM_ADMIN');
    const monitoring = await signIn(NEW, PASSWORD_B);
    expect(monitoring.credentialPurpose).toBe('MONITORING');
  });

  it('is reversible with the addresses swapped', async () => {
    const back = run([
      '--from',
      NEW,
      '--to',
      OLD,
      '--expect-id',
      id,
      '--reason',
      `rehearsal ${suffix} reversal`,
      '--apply',
    ]);
    expect(back.out, back.out).toContain('APPLIED');
    expect(back.code).toBe(0);
    expect((await identity()).email).toBe(OLD);
    expect(
      (await prisma.user.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, id: salesUserId } })).email,
    ).toBe(OLD);
    expect(
      await prisma.platformAuditEvent.count({
        where: { event: 'IDENTITY_EMAIL_CHANGED', metadata: { path: ['platformUserId'], equals: id } },
      }),
    ).toBe(2);
  });
});
