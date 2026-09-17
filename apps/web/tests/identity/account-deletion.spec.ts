import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { totp, currentTotpStep } from '@/lib/auth/mfa';
import { encryptSecret } from '@/services/identity/secrets';
import {
  cancelAccountDeletion,
  deletionBlockers,
  myDeletionRequest,
  requestAccountDeletion,
} from '@/services/identity/accountDeletion';
import { createWorkspaceUser, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import type { Ctx } from '@/lib/security/rbac';

/**
 * Deleting your own account, from the request end.
 *
 * The cases here are the ones where getting it wrong costs somebody else something:
 * a request that erases a workspace's only administrator, a request that reaches
 * across a tenant boundary, and a double tap that becomes two rows. The erasure
 * executor is tested separately — nothing here may be read as evidence that data
 * was deleted, only that the request was recorded correctly.
 */

const PASSWORD = 'Correct-Horse-Battery-9!';

/** A Ctx shaped like the one `route()` builds, for the fields these services read. */
function ctxFor(tenantId: string, userId: string): Ctx {
  return {
    tenantId,
    actor: { id: userId, permissions: new Map() },
    requestId: `test-${Math.random().toString(36).slice(2)}`,
    ip: '127.0.0.1',
    userAgent: 'vitest',
  } as unknown as Ctx;
}

/** Gives an existing fixture user a real credential, so reauthentication can be exercised. */
async function withPassword(salesUserId: string, password = PASSWORD) {
  const membership = await prisma.workspaceMembership.findUniqueOrThrow({
    where: { salesUserId },
    select: { platformUserId: true },
  });
  await prisma.platformUser.update({
    where: { id: membership.platformUserId },
    data: { passwordHash: await hashPassword(password) },
  });
  return membership.platformUserId;
}

let fixture: Fixture;

beforeAll(async () => {
  fixture = await seedTwoTenants();
});

afterAll(async () => {
  await prisma.accountDeletionRequest.deleteMany({});
  await fixture.cleanup();
});

describe('requesting deletion of your own account', () => {
  it('refuses a wrong password and records nothing', async () => {
    const platformUserId = await withPassword(fixture.a.userId);
    const ctx = ctxFor(fixture.a.tenantId, fixture.a.userId);

    await expect(requestAccountDeletion(ctx, { password: 'not-my-password' })).rejects.toThrow();
    // The proof is checked before anything is written: a refused attempt leaves no row,
    // otherwise a stranger with the phone could fill the queue.
    expect(await prisma.accountDeletionRequest.count({ where: { platformUserId } })).toBe(0);
  });

  it('records a request for an ordinary member, and reads it back', async () => {
    // A rank-60 rep in tenant A: not an administrator, so nothing blocks them.
    const role = await prisma.role.create({
      data: { tenantId: fixture.a.tenantId, key: `rep-${Date.now()}`, name: 'Rep', rank: 60, defaultScope: 'OWN' },
    });
    const rep = await createWorkspaceUser({
      tenantId: fixture.a.tenantId,
      roleId: role.id,
      email: `rep-${Date.now()}@example.com`,
      fullName: 'Ordinary Rep',
    });
    const platformUserId = await withPassword(rep.id);
    const ctx = ctxFor(fixture.a.tenantId, rep.id);

    const request = await requestAccountDeletion(ctx, { password: PASSWORD, reason: 'leaving' });
    expect(request.status).toBe('REQUESTED');
    expect(request.blockers).toEqual([]);

    const mine = await myDeletionRequest(ctx);
    expect(mine?.id).toBe(request.id);
    expect(mine?.status).toBe('REQUESTED');
    // Recorded, not performed: the account must still be able to sign in until the
    // executor has run, and the row is the only thing that has changed.
    const identity = await prisma.platformUser.findUniqueOrThrow({
      where: { id: platformUserId },
      select: { deletedAt: true, status: true, passwordHash: true },
    });
    expect(identity.deletedAt).toBeNull();
    expect(identity.status).toBe('ACTIVE');
    expect(identity.passwordHash).not.toBeNull();
  });

  it('refuses a second request through the database, not a read-then-write', async () => {
    const role = await prisma.role.create({
      data: { tenantId: fixture.a.tenantId, key: `rep2-${Date.now()}`, name: 'Rep2', rank: 60, defaultScope: 'OWN' },
    });
    const rep = await createWorkspaceUser({
      tenantId: fixture.a.tenantId,
      roleId: role.id,
      email: `rep2-${Date.now()}@example.com`,
      fullName: 'Double Tapper',
    });
    const platformUserId = await withPassword(rep.id);
    const ctx = ctxFor(fixture.a.tenantId, rep.id);

    await requestAccountDeletion(ctx, { password: PASSWORD });
    await expect(requestAccountDeletion(ctx, { password: PASSWORD })).rejects.toThrow(
      /already have a deletion request/i,
    );

    // Two taps on a slow connection: both in flight at once, still one row. This is the
    // partial unique index doing the work — a check-then-insert would let both through.
    expect(await prisma.accountDeletionRequest.count({ where: { platformUserId } })).toBe(1);
  });

  it('records a genuinely concurrent double request only once', async () => {
    const role = await prisma.role.create({
      data: { tenantId: fixture.a.tenantId, key: `rep3-${Date.now()}`, name: 'Rep3', rank: 60, defaultScope: 'OWN' },
    });
    const rep = await createWorkspaceUser({
      tenantId: fixture.a.tenantId,
      roleId: role.id,
      email: `rep3-${Date.now()}@example.com`,
      fullName: 'Race Condition',
    });
    const platformUserId = await withPassword(rep.id);
    const ctx = ctxFor(fixture.a.tenantId, rep.id);

    const results = await Promise.allSettled([
      requestAccountDeletion(ctx, { password: PASSWORD }),
      requestAccountDeletion(ctx, { password: PASSWORD }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.accountDeletionRequest.count({ where: { platformUserId } })).toBe(1);
  });
});

describe('the second factor', () => {
  it('demands a code when enrolled, and refuses a replayed one', async () => {
    const role = await prisma.role.create({
      data: { tenantId: fixture.a.tenantId, key: `mfa-${Date.now()}`, name: 'MfaRep', rank: 60, defaultScope: 'OWN' },
    });
    const rep = await createWorkspaceUser({
      tenantId: fixture.a.tenantId,
      roleId: role.id,
      email: `mfa-${Date.now()}@example.com`,
      fullName: 'Two Factor',
    });
    const platformUserId = await withPassword(rep.id);
    const secret = 'JBSWY3DPEHPK3PXP';
    await prisma.platformUser.update({
      where: { id: platformUserId },
      data: { mfaEnabled: true, mfaSecret: encryptSecret(secret), mfaLastUsedStep: null },
    });
    const ctx = ctxFor(fixture.a.tenantId, rep.id);

    // The password alone is not enough once a second factor exists.
    await expect(requestAccountDeletion(ctx, { password: PASSWORD })).rejects.toThrow(/authenticator/i);

    const code = totp(secret, currentTotpStep());
    const request = await requestAccountDeletion(ctx, { password: PASSWORD, mfaCode: code });
    expect(request.status).toBe('REQUESTED');

    // Same code again, after cancelling, must not work: consumeTotp burned the step, so a
    // code captured over someone's shoulder cannot confirm a second destructive action.
    await cancelAccountDeletion(ctx);
    await expect(requestAccountDeletion(ctx, { password: PASSWORD, mfaCode: code })).rejects.toThrow();
  });
});

describe('administrators who cannot simply leave', () => {
  it('records the primary administrator as BLOCKED and names the workspace', async () => {
    const membership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { salesUserId: fixture.b.userId },
      select: { id: true, platformUserId: true },
    });
    await prisma.workspaceMembership.update({ where: { id: membership.id }, data: { isPrimaryAdmin: true } });
    await withPassword(fixture.b.userId);
    const ctx = ctxFor(fixture.b.tenantId, fixture.b.userId);

    const blockers = await deletionBlockers(membership.platformUserId);
    expect(blockers.map((b) => b.reason)).toContain('PRIMARY_ADMIN');

    const request = await requestAccountDeletion(ctx, { password: PASSWORD });
    // Recorded, not refused: somebody who cannot leave yet must still be able to ask, or
    // the only route left is a support mailbox, which is what this replaces.
    expect(request.status).toBe('BLOCKED');
    expect(request.blockedReason).toContain(fixture.b.slug);
    expect(request.blockedReason).toMatch(/primary administrator/i);

    await prisma.workspaceMembership.update({ where: { id: membership.id }, data: { isPrimaryAdmin: false } });
  });

  it('looks across every workspace, not only the one being used', async () => {
    // An ordinary member of A who is also the primary administrator of B. Asking from A
    // must still find B, or erasing the credential would lock B out of its own workspace.
    const roleA = await prisma.role.create({
      data: { tenantId: fixture.a.tenantId, key: `multi-${Date.now()}`, name: 'MultiA', rank: 60, defaultScope: 'OWN' },
    });
    const inA = await createWorkspaceUser({
      tenantId: fixture.a.tenantId,
      roleId: roleA.id,
      email: `multi-${Date.now()}@example.com`,
      fullName: 'Two Workspaces',
    });
    const platformUserId = await withPassword(inA.id);

    const roleB = await prisma.role.findFirstOrThrow({ where: { tenantId: fixture.b.tenantId } });
    const inB = await prisma.user.create({
      data: {
        tenantId: fixture.b.tenantId,
        email: `multi-b-${Date.now()}@example.com`,
        fullName: 'Two Workspaces',
        roleId: roleB.id,
        status: 'ACTIVE',
      },
    });
    await prisma.workspaceMembership.create({
      data: {
        tenantId: fixture.b.tenantId,
        platformUserId,
        salesUserId: inB.id,
        status: 'ACTIVE',
        isPrimaryAdmin: true,
        joinedAt: new Date(),
      },
    });

    const blockers = await deletionBlockers(platformUserId);
    expect(blockers.map((b) => b.workspace)).toContain(fixture.b.slug);

    const request = await requestAccountDeletion(ctxFor(fixture.a.tenantId, inA.id), { password: PASSWORD });
    expect(request.status).toBe('BLOCKED');
    expect(request.blockedReason).toContain(fixture.b.slug);
  });
});

describe('cancelling', () => {
  it('withdraws a request that has not started, and refuses one that has', async () => {
    const role = await prisma.role.create({
      data: {
        tenantId: fixture.a.tenantId,
        key: `cancel-${Date.now()}`,
        name: 'Canceller',
        rank: 60,
        defaultScope: 'OWN',
      },
    });
    const rep = await createWorkspaceUser({
      tenantId: fixture.a.tenantId,
      roleId: role.id,
      email: `cancel-${Date.now()}@example.com`,
      fullName: 'Changed Mind',
    });
    const platformUserId = await withPassword(rep.id);
    const ctx = ctxFor(fixture.a.tenantId, rep.id);

    const request = await requestAccountDeletion(ctx, { password: PASSWORD });
    const cancelled = await cancelAccountDeletion(ctx);
    expect(cancelled.status).toBe('CANCELLED');
    expect(await myDeletionRequest(ctx)).toBeNull();

    // Cancelling frees the slot: the partial index only holds open statuses, so somebody
    // who changes their mind twice is not locked out for ever.
    const again = await requestAccountDeletion(ctx, { password: PASSWORD });
    expect(again.status).toBe('REQUESTED');

    // Once the executor has picked it up there is no going back — a half-erased account
    // cannot be restored by flipping a status, so IN_PROGRESS must refuse.
    await prisma.accountDeletionRequest.update({
      where: { id: again.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
    await expect(cancelAccountDeletion(ctx)).rejects.toThrow();
    expect(
      (await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: again.id }, select: { status: true } }))
        .status,
    ).toBe('IN_PROGRESS');
    void request;
    void platformUserId;
  });
});
