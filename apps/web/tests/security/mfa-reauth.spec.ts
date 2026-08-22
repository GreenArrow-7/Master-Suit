/**
 * Enrolling an authenticator is a credential change, so it re-authenticates.
 *
 * Both enrolment routes used to accept a bare authenticated context. Whoever
 * completed enrolment ended up holding a factor on the account *and* walking
 * away with the recovery codes — the codes that are the only way back in when
 * the authenticator is lost. Nothing distinguished the owner enrolling from
 * somebody else enrolling on their behalf.
 *
 * That made two things possible:
 *
 *   * a session borrowed for a minute — an unlocked laptop, a stolen cookie —
 *     became durable control of the account, which is precisely the outcome
 *     `changeOwnPassword` already demands a password to prevent;
 *   * an API key, which authenticates as the user who created it, could enrol
 *     an authenticator on that person's account despite holding none of their
 *     credentials and despite any scope narrowing.
 *
 * The first-run flow is the deliberate exception and is pinned below: an
 * MFA_ENROLMENT grant is minted seconds after a password check, reaches nothing
 * else, and is revoked on completion, so demanding the password a second time
 * would only strand the person the workspace is compelling to enrol.
 */
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { issueApiKey } from '@/lib/auth/apiKey';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { POST as selfAction } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/self/[action]/route';
import { POST as enroll2fa } from '@/app/api/v1/auth/enroll-2fa/route';
import { post } from '../helpers/request';

const suffix = randomBytes(5).toString('hex');
const slug = `reauth-${suffix}`;
const email = `reauth-${suffix}@mfa.test`;
const PASSWORD = 'ReauthPassword1!';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

let tenantId = '';
let platformUserId = '';
let salesUserId = '';
let sessionCookie = '';
let apiKey = '';

const params = { workspaceSlug: slug, action: 'two-factor-begin' };
const path = `/api/v1/workspaces/${slug}/identity/self/two-factor-begin`;

async function session(purpose: 'FULL' | 'MFA_ENROLMENT') {
  const token = randomBytes(32).toString('base64url');
  await prisma.platformSession.create({
    data: {
      platformUserId,
      activeTenantId: tenantId,
      tokenHash: sha256(token),
      mfaSatisfied: false,
      purpose,
      expiresAt: new Date(Date.now() + 30 * 60_000),
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    },
  });
  return `${SESSION_COOKIE}=${token}`;
}

/** enroll-2fa is a bare handler, not a kernel route, so it is called directly. */
async function callEnroll(cookie: string, body: Record<string, unknown>) {
  const res = await enroll2fa(
    new Request('http://localhost/api/v1/auth/enroll-2fa', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Reauth LLC', displayName: 'Reauth', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const role = await prisma.role.create({
    data: { tenantId, key: `admin-${suffix}`, name: 'Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email, fullName: 'Reauth Person', status: 'ACTIVE', passwordHash },
  });
  platformUserId = platformUser.id;
  const user = await prisma.user.create({
    data: { tenantId, email, fullName: 'Reauth Person', roleId: role.id, status: 'ACTIVE' },
  });
  salesUserId = user.id;
  await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId, salesUserId, status: 'ACTIVE', joinedAt: new Date() },
  });

  sessionCookie = await session('FULL');
  apiKey = (await issueApiKey(tenantId, 'reauth-key', role.id, [], salesUserId)).key;
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser.delete({ where: { id: platformUserId } }).catch(() => {});
});

/** MFA must stay off, or a later case would be testing the wrong refusal. */
async function assertNotEnrolled() {
  const row = await prisma.platformUser.findUniqueOrThrow({
    where: { id: platformUserId },
    select: { mfaEnabled: true },
  });
  expect(row.mfaEnabled).toBe(false);
}

describe('MFAREAUTH-001: identity/self enrolment re-authenticates', () => {
  it('refuses a session that does not supply the password', async () => {
    const res = await post(selfAction, path, {}, sessionCookie, params);
    expect(res.status).toBeGreaterThanOrEqual(400);
    await assertNotEnrolled();
  });

  it('refuses a session supplying the wrong password', async () => {
    const res = await post(selfAction, path, { currentPassword: 'NotThePassword1!' }, sessionCookie, params);
    expect(res.status).toBe(403);
    await assertNotEnrolled();
  });

  it('refuses an API key outright — a machine credential cannot own a human factor', async () => {
    const res = await post(selfAction, path, { currentPassword: PASSWORD }, { apiKey }, params);
    expect(res.status).toBe(403);
    await assertNotEnrolled();
  });

  it('issues a secret to the account owner proving the password', async () => {
    const res = await post(selfAction, path, { currentPassword: PASSWORD }, sessionCookie, params);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(typeof res.body.secret).toBe('string');
    // Issuing a secret is not enabling: MFA stays off until a code is confirmed.
    await assertNotEnrolled();
  });
});

describe('MFAREAUTH-002: enroll-2fa distinguishes forced from voluntary', () => {
  it('refuses a FULL session with no password', async () => {
    const res = await callEnroll(sessionCookie, { step: 'begin' });
    expect(res.status).toBe(403);
    await assertNotEnrolled();
  });

  it('refuses a FULL session with the wrong password', async () => {
    const res = await callEnroll(sessionCookie, { step: 'begin', currentPassword: 'NotThePassword1!' });
    expect(res.status).toBe(403);
    await assertNotEnrolled();
  });

  it('accepts a FULL session that proves the password', async () => {
    const res = await callEnroll(sessionCookie, { step: 'begin', currentPassword: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(typeof res.body.secret).toBe('string');
  });

  it('still lets a forced first-run grant enrol without one — it just proved the password at login', async () => {
    const enrolmentGrant = await session('MFA_ENROLMENT');
    const res = await callEnroll(enrolmentGrant, { step: 'begin' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(typeof res.body.secret).toBe('string');
  });
});
