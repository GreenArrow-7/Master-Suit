/**
 * P1-9 — one identity, one credential.
 *
 * `User` (a workspace membership) carried a duplicate of every authentication
 * column `PlatformUser` (the person) already had, kept in step by hand. It was
 * not: `auth/reset-password` wrote only the User copy while `auth/login` reads
 * only PlatformUser, so a reset was inert and a leaked password stayed valid.
 * Workspace provisioning had the mirror bug — its upsert skipped the password on
 * the update branch, producing an administrator who could not sign in.
 *
 * The columns are gone. These tests keep them gone, and pin the behaviour that
 * used to be silent.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { changeOwnPassword, mustChangePassword, resetUserPassword } from '@/services/identity/accounts';
import { buildActor, buildCtx } from '../helpers/ctx';

const suffix = randomBytes(4).toString('hex');
const slug = `cred-${suffix}`;
const OLD = 'OriginalPassword1!';

let tenantId = '';
let adminUserId = '';
let adminRoleId = '';
let memberUserId = '';
let memberPlatformId = '';
let adminPlatformId = '';

/** The credential columns that must not come back on the membership row. */
const FORBIDDEN_ON_USER = [
  'passwordHash',
  'mfaEnabled',
  'mfaSecret',
  'mfaRecoveryCodes',
  'failedLoginCount',
  'lockedUntil',
  'lastLoginAt',
  'passwordChangedAt',
];

async function makePerson(email: string, roleId: string, password: string) {
  const passwordHash = await hashPassword(password);
  const salesUser = await prisma.user.create({
    data: { tenantId, email, fullName: email, roleId, status: 'ACTIVE' },
  });
  const platformUser = await prisma.platformUser.create({
    data: {
      email,
      normalizedEmail: email,
      fullName: email,
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      passwordChangedAt: new Date(),
    },
  });
  await prisma.workspaceMembership.create({
    data: {
      tenantId,
      platformUserId: platformUser.id,
      salesUserId: salesUser.id,
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });
  return { salesUserId: salesUser.id, platformUserId: platformUser.id };
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug, legalName: 'Cred LLC', displayName: 'Cred', status: 'ACTIVE' },
  });
  tenantId = tenant.id;

  const adminRole = await prisma.role.create({
    data: { tenantId, key: `admin-${suffix}`, name: 'Admin', rank: 10, defaultScope: 'ORGANIZATION' },
  });
  adminRoleId = adminRole.id;
  const memberRole = await prisma.role.create({
    data: { tenantId, key: `member-${suffix}`, name: 'Member', rank: 60, defaultScope: 'OWN' },
  });

  const admin = await makePerson(`admin-${suffix}@cred.test`, adminRole.id, OLD);
  adminUserId = admin.salesUserId;
  adminPlatformId = admin.platformUserId;
  const member = await makePerson(`member-${suffix}@cred.test`, memberRole.id, OLD);
  memberUserId = member.salesUserId;
  memberPlatformId = member.platformUserId;
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  for (const id of [adminPlatformId, memberPlatformId]) {
    if (id) await prisma.platformUser.delete({ where: { id } }).catch(() => {});
  }
});

const adminCtx = () =>
  buildCtx(
    buildActor({
      id: adminUserId,
      tenantId,
      roleId: adminRoleId,
      roleKey: 'admin',
      roleRank: 10,
      permissions: new Map(),
    }),
  );

describe('the membership row holds no credential', () => {
  it.each(FORBIDDEN_ON_USER)('User has no %s column', async (column) => {
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'User' AND column_name = $1`,
      column,
    );
    expect(Number(row.n)).toBe(0);
  });

  it('PlatformUser still has them — they moved, they were not deleted', async () => {
    const rows = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'PlatformUser'`,
    );
    const present = new Set(rows.map((r) => r.column_name));
    for (const column of FORBIDDEN_ON_USER) expect(present.has(column)).toBe(true);
  });
});

describe('changing your own password', () => {
  it('verifies and writes the identity, not the membership', async () => {
    const ctx = buildCtx(
      buildActor({
        id: memberUserId,
        tenantId,
        roleId: 'irrelevant',
        roleKey: 'member',
        roleRank: 60,
        permissions: new Map(),
      }),
    );

    const before = await prisma.platformUser.findUnique({
      where: { id: memberPlatformId },
      select: { passwordHash: true },
    });
    await changeOwnPassword(ctx, OLD, 'ReplacementPassword2!');
    const after = await prisma.platformUser.findUnique({
      where: { id: memberPlatformId },
      select: { passwordHash: true },
    });

    expect(after!.passwordHash).not.toBe(before!.passwordHash);
    expect(await verifyPassword(after!.passwordHash!, 'ReplacementPassword2!')).toBe(true);
    expect(await verifyPassword(after!.passwordHash!, OLD)).toBe(false);
  });

  it('refuses the wrong current password', async () => {
    const ctx = buildCtx(
      buildActor({
        id: memberUserId,
        tenantId,
        roleId: 'irrelevant',
        roleKey: 'member',
        roleRank: 60,
        permissions: new Map(),
      }),
    );
    await expect(changeOwnPassword(ctx, 'NotTheCurrentOne9!', 'AnotherPassword3!')).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('an administrator resetting someone else', () => {
  it('writes the identity and forces a change on next sign-in', async () => {
    const result = await resetUserPassword(adminCtx(), memberUserId);
    expect(result.temporaryPassword).toBeTruthy();

    const identity = await prisma.platformUser.findUnique({
      where: { id: memberPlatformId },
      select: { passwordHash: true, passwordChangedAt: true },
    });
    expect(await verifyPassword(identity!.passwordHash!, result.temporaryPassword)).toBe(true);
    // Null is what the forced-change gate reads.
    expect(identity!.passwordChangedAt).toBeNull();
  });

  it('mustChangePassword reads the identity', async () => {
    const memberCtx = buildCtx(
      buildActor({
        id: memberUserId,
        tenantId,
        roleId: 'irrelevant',
        roleKey: 'member',
        roleRank: 60,
        permissions: new Map(),
      }),
    );
    expect(await mustChangePassword(memberCtx)).toBe(true);

    await prisma.platformUser.update({ where: { id: memberPlatformId }, data: { passwordChangedAt: new Date() } });
    expect(await mustChangePassword(memberCtx)).toBe(false);
  });
});
