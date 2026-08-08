/**
 * P1-3 — mandatory 2FA must be enforceable, not a trap.
 *
 * Setting `organizationSetting.mfaRequired = true` used to demand a TOTP code
 * from every user who had not enrolled. They had no secret to generate one
 * from, and there was no enrolment path, so the setting locked them out
 * permanently. An administrator turning on a security control should not be
 * able to lock out their whole company.
 *
 * The fix issues a restricted `MFA_ENROLMENT` grant instead of a session. These
 * tests pin the three properties the brief named: a protected API rejects the
 * grant, an expired grant is rejected, and a reused grant is rejected.
 */
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { generateSecret, totp } from '@/lib/auth/mfa';
import { encryptSecret } from '@/services/identity/secrets';
import { resolvePlatformCtx, SESSION_COOKIE, MFA_ENROLMENT_TTL_MINUTES } from '@/lib/auth/session';
import { GET as hrRead } from '@/app/api/v1/workspaces/[workspaceSlug]/hr/[resource]/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { get, post } from '../helpers/request';
import type { Grants } from '../helpers/fixtures';

const suffix = randomBytes(5).toString('hex');
const slug = `mfa-${suffix}`;
const email = `enrolme-${suffix}@mfa.test`;
const PASSWORD = 'EnrolmentPassword1!';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

let tenantId = '';
let platformUserId = '';
let salesUserId = '';

/** Mints a grant row directly, so expiry and reuse can be controlled. */
async function grant(overrides: { purpose?: string; expiresAt?: Date; revokedAt?: Date } = {}) {
  const token = randomBytes(32).toString('base64url');
  await prisma.platformSession.create({
    data: {
      platformUserId,
      activeTenantId: tenantId,
      tokenHash: sha256(token),
      mfaSatisfied: false,
      purpose: overrides.purpose ?? 'MFA_ENROLMENT',
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 10 * 60_000),
      revokedAt: overrides.revokedAt ?? null,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    },
  });
  return `${SESSION_COOKIE}=${token}`;
}

const asRequest = (cookie: string) => new Request('http://localhost/', { headers: { cookie } });

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'MFA LLC', displayName: 'MFA', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'HRMS', state: 'ACTIVE' } });
  // The policy that used to be a trap.
  await prisma.organizationSetting.create({ data: { tenantId, mfaRequired: true } });

  const role = await prisma.role.create({
    data: { tenantId, key: `hr-${suffix}`, name: 'HR', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  for (const [module, action] of [
    ['employee', 'VIEW'],
    ['employee', 'EDIT'],
  ] as Grants) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action },
    });
    await prisma.rolePermission.create({
      data: { tenantId, roleId: role.id, permissionId: permission.id, granted: true, scope: 'ORGANIZATION' },
    });
  }

  const salesUser = await prisma.user.create({
    data: { tenantId, email, fullName: 'Enrol Me', roleId: role.id, status: 'ACTIVE' },
  });
  salesUserId = salesUser.id;
  const platformUser = await prisma.platformUser.create({
    data: {
      email,
      normalizedEmail: email,
      fullName: 'Enrol Me',
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      // The whole point: policy requires MFA, this account has no secret.
      mfaEnabled: false,
      mfaSecret: null,
    },
  });
  platformUserId = platformUser.id;
  await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId, salesUserId, status: 'ACTIVE', roleSnapshot: role.key, joinedAt: new Date() },
  });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  if (platformUserId) await prisma.platformUser.delete({ where: { id: platformUserId } }).catch(() => {});
});

describe('login under a mandatory-2FA policy', () => {
  it('offers enrolment instead of demanding an impossible code', async () => {
    const res = await post(login, '/api/v1/auth/login', { email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.mfaEnrolmentRequired).toBe(true);
    expect(res.body.destination).toBe('/enroll-2fa');
    // Emphatically not a signed-in session.
    expect(res.body.user).toBeUndefined();
  });

  it('issues a grant that is short-lived and marked as restricted', async () => {
    const session = await prisma.platformSession.findFirst({
      where: { platformUserId, purpose: 'MFA_ENROLMENT' },
      orderBy: { createdAt: 'desc' },
    });
    expect(session).not.toBeNull();
    expect(session!.mfaSatisfied).toBe(false);
    const lifetimeMinutes = (session!.expiresAt.getTime() - session!.createdAt.getTime()) / 60_000;
    expect(lifetimeMinutes).toBeLessThanOrEqual(MFA_ENROLMENT_TTL_MINUTES + 1);
  });
});

describe('an enrolment grant opens nothing else', () => {
  it('a protected API rejects it', async () => {
    const cookie = await grant();
    const res = await get(hrRead, `/api/v1/workspaces/${slug}/hr/departments`, cookie, {
      workspaceSlug: slug,
      resource: 'departments',
    });
    expect(res.status).toBe(401);
  });

  it('resolvePlatformCtx rejects it by default', async () => {
    const cookie = await grant();
    await expect(resolvePlatformCtx(asRequest(cookie), 'test')).rejects.toMatchObject({ status: 401 });
  });

  it('resolvePlatformCtx admits it only where explicitly allowed', async () => {
    const cookie = await grant();
    const ctx = await resolvePlatformCtx(asRequest(cookie), 'test', ['FULL', 'MFA_ENROLMENT']);
    expect(ctx.purpose).toBe('MFA_ENROLMENT');
  });

  it('rejects an expired grant', async () => {
    const cookie = await grant({ expiresAt: new Date(Date.now() - 60_000) });
    await expect(resolvePlatformCtx(asRequest(cookie), 'test', ['FULL', 'MFA_ENROLMENT'])).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects a reused grant once enrolment has spent it', async () => {
    // What the enrolment route does on success: revoke, then issue a real session.
    const cookie = await grant({ revokedAt: new Date() });
    await expect(resolvePlatformCtx(asRequest(cookie), 'test', ['FULL', 'MFA_ENROLMENT'])).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects a tampered token', async () => {
    const cookie = await grant();
    const tampered = cookie.slice(0, -4) + 'AAAA';
    await expect(resolvePlatformCtx(asRequest(tampered), 'test', ['FULL', 'MFA_ENROLMENT'])).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('after enrolment the account logs in normally', () => {
  it('accepts a real TOTP code and issues a full session', async () => {
    const secret = generateSecret();
    await prisma.platformUser.update({
      where: { id: platformUserId },
      data: { mfaSecret: encryptSecret(secret), mfaEnabled: true },
    });

    const res = await post(login, '/api/v1/auth/login', {
      email,
      password: PASSWORD,
      mfaCode: totp(secret, Math.floor(Date.now() / 1000 / 30)),
    });

    expect(res.status).toBe(200);
    expect(res.body.mfaEnrolmentRequired).toBeUndefined();
    expect(res.body.user?.email).toBe(email);
  });
});
