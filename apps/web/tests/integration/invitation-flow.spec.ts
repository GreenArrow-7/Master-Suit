/**
 * 4.2 — invitations are the only way a login comes into existence.
 *
 * Before this, an administrator typed a plaintext password into a form and read
 * it out. Every account began life with a credential someone else knew, there
 * was no expiry, and an offer once made could not be withdrawn — while
 * `UserStatus.INVITED` sat in the schema, counted against seat limits, and was
 * never set by anything.
 *
 * Drives invite → email → preview → accept → sign in, plus resend, revoke,
 * expiry, replay and the seat limit.
 */
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';
import { verifyPassword } from '@/lib/auth/password';
import { mockOutbox } from '@/lib/mailer';
import {
  acceptInvitation,
  inviteUser,
  resendInvitation,
  revokeInvitation,
  previewInvitation,
} from '@/services/identity/invitations';
import { buildActor, buildCtx } from '../helpers/ctx';

const suffix = randomBytes(4).toString('hex');
const slug = `invite-${suffix}`;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

let tenantId = '';
let adminUserId = '';
let adminRoleId = '';
let memberRoleId = '';

/** The token from the invitation email, as the recipient would take it. */
function tokenFromEmail(to: string): string | null {
  const match = mockOutbox.lastTo(to)?.body.match(/accept-invite\?token=([^\s]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

const adminCtx = () =>
  buildCtx(
    buildActor({
      id: adminUserId,
      tenantId,
      roleId: adminRoleId,
      roleKey: 'admin',
      roleRank: 10,
      permissions: new Map([['users:MANAGE_USERS', 'ORGANIZATION']]),
    }),
  );

const address = (label: string) => `${label}-${suffix}@invite.test`;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Invite LLC', displayName: 'Invite Co', status: 'ACTIVE' },
  });
  tenantId = tenant.id;

  const adminRole = await prisma.role.create({
    data: { tenantId, key: `admin-${suffix}`, name: 'Administrator', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  adminRoleId = adminRole.id;
  const memberRole = await prisma.role.create({
    data: { tenantId, key: `member-${suffix}`, name: 'Member', rank: 60, defaultScope: 'OWN' },
  });
  memberRoleId = memberRole.id;

  const admin = await prisma.user.create({
    data: { tenantId, email: address('admin'), fullName: 'Admin', roleId: adminRole.id, status: 'ACTIVE' },
  });
  adminUserId = admin.id;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.platformUser
    .deleteMany({ where: { normalizedEmail: { contains: `-${suffix}@invite.test` } } })
    .catch(() => {});
});

beforeEach(async () => {
  mockOutbox.clear();
  const keys = await redis.keys('rl:invite:*');
  if (keys.length) await redis.del(...keys);
});

describe('sending an invitation', () => {
  it('creates a pending record and emails a link — no password anywhere', async () => {
    const email = address('newcomer');
    const invitation = await inviteUser(adminCtx(), { email, fullName: 'New Comer', roleId: memberRoleId });

    expect(invitation.status).toBe('PENDING');
    expect(invitation).not.toHaveProperty('tokenHash');

    const mail = mockOutbox.lastTo(email);
    expect(mail).toBeDefined();
    expect(tokenFromEmail(email)).toBeTruthy();
    // The sender never sees a credential, and none exists yet.
    expect(mail!.body).toMatch(/choose your own password/i);
    expect(await prisma.platformUser.findUnique({ where: { normalizedEmail: email } })).toBeNull();
  });

  it('stores the token hashed — a leaked row is not redeemable', async () => {
    const email = address('hashed');
    await inviteUser(adminCtx(), { email, fullName: 'Hash Test', roleId: memberRoleId });
    const token = tokenFromEmail(email)!;

    const row = await prisma.workspaceInvitation.findFirst({ where: { tenantId, email } });
    expect(row!.tokenHash).toBe(sha256(token));
    expect(row!.tokenHash).not.toBe(token);
  });

  it('refuses a role the inviter could not administer', async () => {
    // Rank 10 inviting into rank 10: equal rank is not administerable, the same
    // rule that stops the HR employee-create path being an escalation (P0-1).
    await expect(
      inviteUser(adminCtx(), { email: address('peer'), fullName: 'Peer', roleId: adminRoleId }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a second open invitation for the same address', async () => {
    const email = address('duplicate');
    await inviteUser(adminCtx(), { email, fullName: 'First', roleId: memberRoleId });
    await expect(inviteUser(adminCtx(), { email, fullName: 'Second', roleId: memberRoleId })).rejects.toThrow();
  });
});

describe('accepting', () => {
  it('creates the account with a password only the recipient has seen', async () => {
    const email = address('accepts');
    await inviteUser(adminCtx(), { email, fullName: 'Accepts Invite', roleId: memberRoleId });
    const token = tokenFromEmail(email)!;

    const preview = await previewInvitation(token);
    expect(preview).toMatchObject({ email, workspaceName: 'Invite Co', roleName: 'Member' });

    const result = await acceptInvitation(token, { password: 'ChosenByMeAlone1!' });
    expect(result).toMatchObject({ workspaceSlug: slug, email, credential: 'CREATED' });

    const identity = await prisma.platformUser.findUnique({ where: { normalizedEmail: email } });
    expect(await verifyPassword(identity!.passwordHash!, 'ChosenByMeAlone1!')).toBe(true);
    // Set, so the forced-change gate does not fire for a password they chose.
    expect(identity!.passwordChangedAt).not.toBeNull();

    const membership = await prisma.workspaceMembership.findFirst({
      where: { tenantId, platformUserId: identity!.id },
      include: { salesUser: { select: { roleId: true, status: true } } },
    });
    expect(membership!.status).toBe('ACTIVE');
    expect(membership!.salesUser!.roleId).toBe(memberRoleId);
  });

  it('creates the HR record when the invitation named an employee number', async () => {
    const email = address('hire');
    await inviteUser(adminCtx(), {
      email,
      fullName: 'New Hire',
      roleId: memberRoleId,
      employeeNumber: `E-${suffix}`,
      jobTitle: 'Consultant',
    });
    await acceptInvitation(tokenFromEmail(email)!, { password: 'NewHirePassword1!' });

    const employee = await prisma.employeeProfile.findFirst({
      where: { tenantId, employeeNumber: `E-${suffix}` },
    });
    expect(employee).not.toBeNull();
    expect(employee!.designation).toBe('Consultant');
  });

  it('refuses a password that fails the workspace policy', async () => {
    const email = address('weak');
    await inviteUser(adminCtx(), { email, fullName: 'Weak Password', roleId: memberRoleId });
    await expect(acceptInvitation(tokenFromEmail(email)!, { password: 'short' })).rejects.toMatchObject({
      status: 422,
    });
    expect(await prisma.platformUser.findUnique({ where: { normalizedEmail: email } })).toBeNull();
  });

  it('spends the token — the same link cannot be redeemed twice', async () => {
    const email = address('once');
    await inviteUser(adminCtx(), { email, fullName: 'Once Only', roleId: memberRoleId });
    const token = tokenFromEmail(email)!;

    await acceptInvitation(token, { password: 'FirstAcceptance1!' });
    await expect(acceptInvitation(token, { password: 'SecondAcceptance2!' })).rejects.toMatchObject({ status: 403 });
  });

  it('refuses an expired invitation', async () => {
    const email = address('stale');
    await inviteUser(adminCtx(), { email, fullName: 'Stale', roleId: memberRoleId });
    const token = tokenFromEmail(email)!;
    await prisma.workspaceInvitation.updateMany({
      where: { tenantId, email },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    expect(await previewInvitation(token)).toBeNull();
    await expect(acceptInvitation(token, { password: 'TooLatePassword1!' })).rejects.toMatchObject({ status: 403 });
  });

  it('keeps an existing identity password rather than overwriting it', async () => {
    // Someone already on the platform, invited to a second workspace. Accepting
    // must not let a second workspace reset the credential guarding the first.
    const email = address('existing');
    const otherTenant = await prisma.tenant.create({
      data: { slug: `other-${suffix}`, legalName: 'Other', displayName: 'Other', status: 'ACTIVE' },
    });
    try {
      await prisma.platformUser.create({
        data: {
          email,
          normalizedEmail: email,
          fullName: 'Already Here',
          passwordHash: await (await import('@/lib/auth/password')).hashPassword('TheirRealPassword1!'),
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          passwordChangedAt: new Date(),
        },
      });

      await inviteUser(adminCtx(), { email, fullName: 'Already Here', roleId: memberRoleId });
      const result = await acceptInvitation(tokenFromEmail(email)!, { password: 'AttemptedOverwrite1!' });

      expect(result.credential).toBe('EXISTING');
      const identity = await prisma.platformUser.findUnique({ where: { normalizedEmail: email } });
      expect(await verifyPassword(identity!.passwordHash!, 'TheirRealPassword1!')).toBe(true);
      expect(await verifyPassword(identity!.passwordHash!, 'AttemptedOverwrite1!')).toBe(false);
    } finally {
      await prisma.tenant.delete({ where: { id: otherTenant.id } }).catch(() => {});
    }
  });
});

describe('withdrawing and resending', () => {
  it('a revoked invitation stops working', async () => {
    const email = address('revoked');
    const invitation = await inviteUser(adminCtx(), { email, fullName: 'Revoked', roleId: memberRoleId });
    const token = tokenFromEmail(email)!;

    await revokeInvitation(adminCtx(), invitation.id, 'changed our mind');
    await expect(acceptInvitation(token, { password: 'RevokedAttempt1!' })).rejects.toMatchObject({ status: 403 });
  });

  it('a revoked address can be invited again', async () => {
    const email = address('again');
    const first = await inviteUser(adminCtx(), { email, fullName: 'Again', roleId: memberRoleId });
    await revokeInvitation(adminCtx(), first.id);
    const second = await inviteUser(adminCtx(), { email, fullName: 'Again', roleId: memberRoleId });
    expect(second.status).toBe('PENDING');
  });

  it('resending issues a new token and retires the old one', async () => {
    const email = address('resent');
    const invitation = await inviteUser(adminCtx(), { email, fullName: 'Resent', roleId: memberRoleId });
    const firstToken = tokenFromEmail(email)!;

    mockOutbox.clear();
    const updated = await resendInvitation(adminCtx(), invitation.id);
    const secondToken = tokenFromEmail(email)!;

    expect(updated.sendCount).toBe(2);
    expect(secondToken).not.toBe(firstToken);
    // A resend is the remedy for a link that went to the wrong inbox.
    await expect(acceptInvitation(firstToken, { password: 'OldLinkAttempt1!' })).rejects.toMatchObject({ status: 403 });
    await expect(acceptInvitation(secondToken, { password: 'NewLinkWorks1!' })).resolves.toBeTruthy();
  });
});

describe('seat limits', () => {
  it('counts pending invitations, not just accepted members', async () => {
    // Promising more seats than exist and discovering it at acceptance means the
    // promise was already made. The limit binds when the invitation is sent.
    const capped = await prisma.tenant.create({
      data: { slug: `capped-${suffix}`, legalName: 'Capped', displayName: 'Capped', status: 'ACTIVE', maxUsers: 1 },
    });
    try {
      // Two roles: inviting into the actor's own would be refused by the rank
      // guard first, which is a different rule from the one under test.
      const ownerRole = await prisma.role.create({
        data: { tenantId: capped.id, key: `own-${suffix}`, name: 'Owner', rank: 10, defaultScope: 'ORGANIZATION' },
      });
      const inviteeRole = await prisma.role.create({
        data: { tenantId: capped.id, key: `inv-${suffix}`, name: 'Member', rank: 60, defaultScope: 'OWN' },
      });
      const owner = await prisma.user.create({
        data: {
          tenantId: capped.id,
          email: `owner-${suffix}@capped.test`,
          fullName: 'Owner',
          roleId: ownerRole.id,
          status: 'ACTIVE',
        },
      });
      const platformOwner = await prisma.platformUser.create({
        data: {
          email: `owner-${suffix}@capped.test`,
          normalizedEmail: `owner-${suffix}@capped.test`,
          fullName: 'Owner',
          status: 'ACTIVE',
        },
      });
      await prisma.workspaceMembership.create({
        data: {
          tenantId: capped.id,
          platformUserId: platformOwner.id,
          salesUserId: owner.id,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
      const ctx = buildCtx(
        buildActor({
          id: owner.id,
          tenantId: capped.id,
          roleId: ownerRole.id,
          roleKey: 'own',
          roleRank: 10,
          permissions: new Map(),
        }),
      );

      // One seat, one member already in it.
      await expect(
        inviteUser(ctx, { email: `over-${suffix}@capped.test`, fullName: 'Over', roleId: inviteeRole.id }),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      await prisma.tenant.delete({ where: { id: capped.id } }).catch(() => {});
      await prisma.platformUser
        .deleteMany({ where: { normalizedEmail: `owner-${suffix}@capped.test` } })
        .catch(() => {});
    }
  });
});
