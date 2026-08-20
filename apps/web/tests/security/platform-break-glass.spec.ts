import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, withPlatformTx } from '@/lib/db';
import { buildSupportActor } from '@/lib/auth/support-actor';
import { MAX_GRANT_MINUTES, activeGrant, openGrant, revokeGrants } from '@/lib/auth/platform-access';

/**
 * Platform write access into a customer workspace must not be ambient.
 *
 * `buildSupportActor` gave a platform OWNER every permission in every tenant at
 * ORGANIZATION scope — create, edit, delete, approve, sensitive fields — from the
 * moment they opened a workspace, permanently, with no record of why. SUPPORT and
 * SECURITY_AUDITOR were already read-only, and the difference was invisible: the
 * workspace-entry audit row recorded `mode: 'platform_support_readonly'` for a
 * session that could delete the customer's payroll.
 *
 * The assertions that matter are the two directions of the same property: an
 * owner who has not asked for write access does not have it, and one whose grant
 * has run out stops having it without anything needing to notice.
 */

const suffix = randomBytes(4).toString('hex');
let tenantId = '';
let ownerId = '';

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `bg-${suffix}`, legalName: `BG ${suffix}`, displayName: `BG ${suffix}` },
  });
  tenantId = tenant.id;

  const owner = await prisma.platformUser.create({
    data: {
      email: `bg-owner-${suffix}@example.test`,
      normalizedEmail: `bg-owner-${suffix}@example.test`,
      fullName: 'Platform Owner',
      platformRole: 'OWNER',
    },
  });
  ownerId = owner.id;
});

afterAll(async () => {
  await withPlatformTx(async (tx) => {
    if (tenantId) await tx.tenant.delete({ where: { id: tenantId } });
    if (ownerId) await tx.platformUser.delete({ where: { id: ownerId } });
  });
});

beforeEach(async () => {
  await prisma.platformAccessGrant.deleteMany({ where: { tenantId } });
});

const canWrite = async (role = 'OWNER') => {
  const actor = await buildSupportActor(tenantId, ownerId, role);
  return actor.permissions.has('leads:CREATE') || actor.permissions.has('leads:EDIT');
};
const canRead = async (role = 'OWNER') =>
  (await buildSupportActor(tenantId, ownerId, role)).permissions.has('leads:VIEW');

describe('without a grant', () => {
  it('lets the owner read but not write', async () => {
    // The change: this used to be full control. Reading a customer's data to
    // answer their question is the ordinary case and still needs no ceremony.
    expect(await canRead()).toBe(true);
    expect(await canWrite()).toBe(false);
  });

  it('withholds sensitive fields as well', async () => {
    const actor = await buildSupportActor(tenantId, ownerId, 'OWNER');
    expect(actor.permissions.has('employee:VIEW_SENSITIVE_FIELDS')).toBe(false);
  });
});

describe('with a grant', () => {
  it('gives full control until it expires', async () => {
    await openGrant({ platformUserId: ownerId, tenantId, reason: 'Repairing a duplicated payroll run' });
    expect(await canWrite()).toBe(true);
    expect(await canRead()).toBe(true);
  });

  it('stops the moment it is handed back', async () => {
    await openGrant({ platformUserId: ownerId, tenantId, reason: 'Repairing a duplicated payroll run' });
    expect(await canWrite()).toBe(true);

    await revokeGrants(ownerId, tenantId);
    // No sign-in, no cache to wait out: the check runs on every request.
    expect(await canWrite()).toBe(false);
    expect(await canRead()).toBe(true);
  });

  it('stops when it expires, with nothing having to sweep it', async () => {
    // Enforced on read rather than by a job, so access ends on time whether or
    // not anything remembers to tidy up — a sweeper that fails to run must not
    // silently extend somebody's authority.
    const grant = await openGrant({ platformUserId: ownerId, tenantId, reason: 'Repairing a duplicated run' });
    await prisma.platformAccessGrant.update({
      where: { id: grant.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await activeGrant(ownerId, tenantId)).toBeNull();
    expect(await canWrite()).toBe(false);
    // The row stays: it is the record of who was in the customer's data and why.
    expect(await prisma.platformAccessGrant.count({ where: { id: grant.id } })).toBe(1);
  });
});

describe('what opening one requires', () => {
  it('refuses a reason too short to be one', async () => {
    // "fix" is a word, not a reason, and this text goes on the customer's own
    // audit trail.
    await expect(openGrant({ platformUserId: ownerId, tenantId, reason: 'fix' })).rejects.toMatchObject({
      status: 422,
    });
    await expect(openGrant({ platformUserId: ownerId, tenantId, reason: '   ' })).rejects.toMatchObject({
      status: 422,
    });
    expect(await canWrite()).toBe(false);
  });

  it('caps the window however long was asked for', async () => {
    const grant = await openGrant({
      platformUserId: ownerId,
      tenantId,
      reason: 'Long data repair across the whole workspace',
      minutes: 60 * 24 * 7,
    });
    const minutes = (grant.expiresAt.getTime() - grant.grantedAt.getTime()) / 60_000;
    expect(minutes).toBeLessThanOrEqual(MAX_GRANT_MINUTES + 1);
  });

  it('refuses a second concurrent grant rather than stacking them', async () => {
    // Two live grants means two expiry times, and "when does this person's
    // access end" stops having one answer.
    await openGrant({ platformUserId: ownerId, tenantId, reason: 'Repairing a duplicated payroll run' });
    await expect(
      openGrant({ platformUserId: ownerId, tenantId, reason: 'Another entirely separate reason' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('is scoped to one workspace', async () => {
    // A grant into one customer must not open another. This is the whole point
    // of a per-tenant row rather than a flag on the session.
    const other = await prisma.tenant.create({
      data: { slug: `bg2-${suffix}`, legalName: 'Other', displayName: 'Other' },
    });
    try {
      await openGrant({ platformUserId: ownerId, tenantId, reason: 'Repairing a duplicated payroll run' });
      const elsewhere = await buildSupportActor(other.id, ownerId, 'OWNER');
      expect(elsewhere.permissions.has('leads:EDIT')).toBe(false);
      expect(elsewhere.permissions.has('leads:VIEW')).toBe(true);
    } finally {
      await withPlatformTx((tx) => tx.tenant.delete({ where: { id: other.id } }));
    }
  });
});

describe('the read-only platform roles', () => {
  it('stay read-only even when a grant exists for that user', async () => {
    // Their read-only status is the reason a customer accepts them looking at
    // all. The route refuses to open a grant for them; this is the second line,
    // in case a row arrives another way.
    await openGrant({ platformUserId: ownerId, tenantId, reason: 'Repairing a duplicated payroll run' });
    for (const role of ['SUPPORT', 'SECURITY_AUDITOR']) {
      expect(await canWrite(role)).toBe(false);
      expect(await canRead(role)).toBe(true);
    }
  });
});
