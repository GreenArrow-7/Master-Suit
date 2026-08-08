import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { resolvePlatformCtx } from '@/lib/auth/session';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { isPlatformOwner, isPrivilegedPlatformRole } from '@/lib/auth/platform-policy';
import { createPlatformSessionToken } from '../helpers/session';

/**
 * Two-factor authentication is mandatory for platform staff.
 *
 * The platform owner reads every customer's data through the console, and
 * OWNER/SUPPORT/SECURITY_AUDITOR can all open any workspace through the support
 * actor without holding a membership. None of that required more than a password
 * before: `resolvePlatformCtx` never looked at `mfaSatisfied`.
 *
 * The authority is the `mfaSatisfied` column on PlatformSession, written by the
 * login route only after a TOTP or recovery code verified. Nothing the client
 * sends contributes to it, which is what the last case here checks.
 */
const suffix = randomBytes(4).toString('hex');
const ids: string[] = [];

let seq = 0;

async function platformUser(role: 'USER' | 'OWNER' | 'SUPPORT' | 'SECURITY_AUDITOR') {
  // Unique per call: several cases create an owner, and the email is unique.
  const email = `mfa.${role.toLowerCase()}.${suffix}.${(seq += 1)}@masterapp.local`;
  const user = await prisma.platformUser.create({
    data: {
      email,
      normalizedEmail: email,
      fullName: `MFA ${role}`,
      status: 'ACTIVE',
      platformRole: role,
    },
  });
  ids.push(user.id);
  return user;
}

/** A request carrying only the session cookie — no other client-supplied state. */
const request = (cookie: string, extra: Record<string, string> = {}) =>
  new Request('http://internal/platform', { headers: { cookie, ...extra } });

/** Flips the server-side flag the way a completed MFA login would. */
async function markMfaSatisfied(cookie: string) {
  const { createHash } = await import('node:crypto');
  const token = decodeURIComponent(cookie.split('=').slice(1).join('='));
  await prisma.platformSession.updateMany({
    where: { tokenHash: createHash('sha256').update(token).digest('hex') },
    data: { mfaSatisfied: true },
  });
}

beforeAll(async () => {
  // Fail loudly rather than silently proving nothing.
  expect(prisma).toBeTruthy();
});

afterAll(async () => {
  await prisma.platformSession.deleteMany({ where: { platformUserId: { in: ids } } }).catch(() => {});
  await prisma.platformUser.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
});

describe('platform role policy', () => {
  it('treats every non-USER platform role as privileged', () => {
    expect(isPrivilegedPlatformRole('OWNER')).toBe(true);
    expect(isPrivilegedPlatformRole('SUPPORT')).toBe(true);
    expect(isPrivilegedPlatformRole('SECURITY_AUDITOR')).toBe(true);
    // An ordinary workspace member must not be dragged into the MFA requirement.
    expect(isPrivilegedPlatformRole('USER')).toBe(false);
  });

  it('still distinguishes the owner from other platform staff', () => {
    expect(isPlatformOwner('OWNER')).toBe(true);
    expect(isPlatformOwner('SUPPORT')).toBe(false);
  });
});

describe('platform MFA enforcement', () => {
  it('refuses a platform owner whose session is password-only', async () => {
    const owner = await platformUser('OWNER');
    const cookie = await createPlatformSessionToken(owner.id, null, { mfaSatisfied: false });

    await expect(resolvePlatformCtx(request(cookie), 'test')).rejects.toThrow(/two-factor/i);
    await expect(requirePlatformOwner(request(cookie), 'test')).rejects.toThrow(/two-factor/i);
  });

  it('admits a platform owner whose session completed MFA', async () => {
    const owner = await platformUser('OWNER');
    const cookie = await createPlatformSessionToken(owner.id, null, { mfaSatisfied: true });

    const ctx = await resolvePlatformCtx(request(cookie), 'test');
    expect(ctx.platformRole).toBe('OWNER');
    expect((await requirePlatformOwner(request(cookie), 'test')).platformUserId).toBe(owner.id);
  });

  it('refuses SUPPORT and SECURITY_AUDITOR too — they also cross tenant boundaries', async () => {
    for (const role of ['SUPPORT', 'SECURITY_AUDITOR'] as const) {
      const staff = await platformUser(role);
      const cookie = await createPlatformSessionToken(staff.id, null, { mfaSatisfied: false });
      await expect(resolvePlatformCtx(request(cookie), 'test'), role).rejects.toThrow(/two-factor/i);
    }
  });

  it('leaves an ordinary workspace user unaffected', async () => {
    const member = await platformUser('USER');
    const cookie = await createPlatformSessionToken(member.id, null, { mfaSatisfied: false });

    const ctx = await resolvePlatformCtx(request(cookie), 'test');
    expect(ctx.platformRole).toBe('USER');
    // …and they are still not an owner.
    await expect(requirePlatformOwner(request(cookie), 'test')).rejects.toThrow(/Platform-owner access/i);
  });

  it('refuses a missing or unknown session', async () => {
    await expect(resolvePlatformCtx(new Request('http://internal/platform'), 'test')).rejects.toThrow();
    await expect(resolvePlatformCtx(request('lf_session=not-a-real-token'), 'test')).rejects.toThrow();
  });

  it('ignores client-supplied MFA claims', async () => {
    const owner = await platformUser('OWNER');
    const cookie = await createPlatformSessionToken(owner.id, null, { mfaSatisfied: false });

    // Everything a caller controls, asserting the opposite of the database.
    const forged = request(cookie, {
      'x-mfa-satisfied': 'true',
      'x-mfa': '1',
      'x-platform-role': 'OWNER',
      authorization: 'Bearer mfa-satisfied',
    });

    await expect(resolvePlatformCtx(forged, 'test')).rejects.toThrow(/two-factor/i);
  });

  it('lets the enrolment grant through, so enforcement is not a lockout', async () => {
    const owner = await platformUser('OWNER');
    const cookie = await createPlatformSessionToken(owner.id, null, {
      mfaSatisfied: false,
      purpose: 'MFA_ENROLMENT',
    });

    // The grant reaches /enroll-2fa and nothing else — which is how an owner
    // without an authenticator gets one rather than being locked out for good.
    const ctx = await resolvePlatformCtx(request(cookie), 'test', ['FULL', 'MFA_ENROLMENT']);
    expect(ctx.purpose).toBe('MFA_ENROLMENT');

    // But it is still not a signed-in session.
    await expect(resolvePlatformCtx(request(cookie), 'test')).rejects.toThrow();
  });

  it('refuses again once the enrolment grant is exchanged without completing MFA', async () => {
    const owner = await platformUser('OWNER');
    const cookie = await createPlatformSessionToken(owner.id, null, { mfaSatisfied: false });
    await expect(resolvePlatformCtx(request(cookie), 'test')).rejects.toThrow(/two-factor/i);

    // Completing MFA is the only thing that changes the answer.
    await markMfaSatisfied(cookie);
    expect((await resolvePlatformCtx(request(cookie), 'test')).platformUserId).toBe(owner.id);
  });
});
