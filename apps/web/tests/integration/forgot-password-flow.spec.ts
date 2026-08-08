/**
 * 4.1 — the whole recovery path, end to end.
 *
 * Before Phase 4 this flow had three independent failures stacked on it: the
 * `/forgot-password` page the sign-in screen linked to did not exist, the API
 * mailed a link to a `/reset-password` page that also did not exist, and the
 * only mail provider was `mock`, so nothing was ever sent. On top of that the
 * reset wrote a table login does not read (P0-3).
 *
 * This drives request → email → link → new password → old password dead.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { mockOutbox } from '@/lib/mailer';
import { redis } from '@/lib/redis';
import { POST as forgotPassword } from '@/app/api/v1/auth/forgot-password/route';
import { POST as resetPassword } from '@/app/api/v1/auth/reset-password/route';
import { post } from '../helpers/request';

const suffix = randomBytes(5).toString('hex');
const email = `recover-${suffix}@flow.test`;
const OLD = 'OriginalPassword1!';
const NEW = 'ReplacementPassword2!';

let tenantId = '';
let platformUserId = '';

/** Pulls the token out of the emailed link, the way a person clicking it would. */
function tokenFromEmail(to: string): string | null {
  const mail = mockOutbox.lastTo(to);
  const match = mail?.body.match(/reset-password\?token=([^\s]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

const currentHash = async () =>
  (await prisma.platformUser.findUnique({ where: { id: platformUserId }, select: { passwordHash: true } }))!
    .passwordHash!;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `flow-${suffix}`, legalName: 'Flow LLC', displayName: 'Flow', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({
    data: { tenantId, key: `member-${suffix}`, name: 'Member', rank: 60, defaultScope: 'OWN' },
  });
  const salesUser = await prisma.user.create({
    data: { tenantId, email, fullName: 'Recover Me', roleId: role.id, status: 'ACTIVE' },
  });
  const platformUser = await prisma.platformUser.create({
    data: {
      email,
      normalizedEmail: email,
      fullName: 'Recover Me',
      passwordHash: await hashPassword(OLD),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  platformUserId = platformUser.id;
  await prisma.workspaceMembership.create({
    data: { tenantId, platformUserId, salesUserId: salesUser.id, status: 'ACTIVE', joinedAt: new Date() },
  });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  if (platformUserId) await prisma.platformUser.delete({ where: { id: platformUserId } }).catch(() => {});
});

/**
 * Each test asks for a fresh link, and the limiter allows three per address per
 * hour — correctly. Clearing the counters between independent tests keeps that
 * limit real in production while letting the cases here run in any order.
 * `tests/security/ratelimit.spec.ts` is what proves the limit itself.
 */
beforeEach(async () => {
  mockOutbox.clear();
  const keys = await redis.keys('rl:pwreset:*');
  if (keys.length) await redis.del(...keys);
});

describe('requesting a link', () => {
  it('sends one, addressed to the account', async () => {
    const res = await post(forgotPassword, '/api/v1/auth/forgot-password', { email });
    expect(res.status).toBe(200);

    const mail = mockOutbox.lastTo(email);
    expect(mail).toBeDefined();
    expect(mail!.subject).toMatch(/reset/i);
    expect(tokenFromEmail(email)).toBeTruthy();
  });

  it('answers identically for an address that does not exist, and sends nothing', async () => {
    const known = await post(forgotPassword, '/api/v1/auth/forgot-password', { email });
    mockOutbox.clear();
    const unknown = await post(forgotPassword, '/api/v1/auth/forgot-password', {
      email: `nobody-${suffix}@flow.test`,
    });

    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(mockOutbox.all()).toHaveLength(0);
  });

  it('needs no workspace slug — nobody locked out knows theirs', async () => {
    const res = await post(forgotPassword, '/api/v1/auth/forgot-password', { email });
    expect(res.status).toBe(200);
  });
});

describe('following the link', () => {
  it('changes the password login reads, and retires the old one', async () => {
    await post(forgotPassword, '/api/v1/auth/forgot-password', { email });
    const token = tokenFromEmail(email);
    expect(token).toBeTruthy();

    const res = await post(resetPassword, '/api/v1/auth/reset-password', { token, newPassword: NEW });
    expect(res.status).toBe(200);

    const hash = await currentHash();
    expect(await verifyPassword(hash, NEW)).toBe(true);
    expect(await verifyPassword(hash, OLD)).toBe(false);
  });

  it('refuses a password that fails the policy, and leaves the old one in place', async () => {
    const before = await currentHash();
    await post(forgotPassword, '/api/v1/auth/forgot-password', { email });
    const token = tokenFromEmail(email);

    const res = await post(resetPassword, '/api/v1/auth/reset-password', { token, newPassword: 'short' });
    expect(res.status).toBe(422);
    expect(await currentHash()).toBe(before);
  });

  it('spends the token — the same link cannot be used twice', async () => {
    await post(forgotPassword, '/api/v1/auth/forgot-password', { email });
    const token = tokenFromEmail(email);

    expect(
      (await post(resetPassword, '/api/v1/auth/reset-password', { token, newPassword: 'FirstUseOfLink3!' })).status,
    ).toBe(200);
    expect(
      (await post(resetPassword, '/api/v1/auth/reset-password', { token, newPassword: 'SecondUseOfLink4!' })).status,
    ).toBe(401);
  });
});

describe('the emailed body', () => {
  it('carries the link but is never written to the log', async () => {
    // sendMail logs `to` and `subject` only. The body holds a live single-use
    // token, and a log pipeline outlives the thirty minutes it is good for.
    await post(forgotPassword, '/api/v1/auth/forgot-password', { email });
    const mail = mockOutbox.lastTo(email)!;
    expect(mail.body).toContain('/reset-password?token=');
    expect(mail.body).toMatch(/expires in 30 minutes/i);
  });
});
