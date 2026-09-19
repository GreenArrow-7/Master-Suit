import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { encryptSecret } from '@/services/identity/secrets';
import {
  cancelAccountDeletion,
  processAccountDeletion,
  requestAccountDeletion,
} from '@/services/identity/accountDeletion';
import { createWorkspaceUser, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import type { Ctx } from '@/lib/security/rbac';

/**
 * Accounts this file created. Teardown removes only these: `deleteMany({})` wiped the
 * table for every suite running in parallel, so a sibling's request vanished mid-test and
 * the executor reported SKIPPED against a row that had been deleted underneath it.
 */
const ownedPlatformUserIds = new Set<string>();

/**
 * What the executor actually erases.
 *
 * The request tests prove a row was written. These prove the data is gone — which is
 * the only thing that may be described as deletion. Each case reads the database back
 * rather than trusting the returned outcome, because the outcome is the executor's own
 * account of itself.
 */

const PASSWORD = 'Correct-Horse-Battery-9!';

function ctxFor(tenantId: string, userId: string): Ctx {
  return {
    tenantId,
    actor: { id: userId, permissions: new Map() },
    requestId: `test-${Math.random().toString(36).slice(2)}`,
    ip: '127.0.0.1',
    userAgent: 'vitest',
  } as unknown as Ctx;
}

let fixture: Fixture;
let roleSeq = 0;

/** A rep in tenant A with a real credential, an authenticator and a live session. */
async function makePerson(name: string) {
  const role = await prisma.role.create({
    data: {
      tenantId: fixture.a.tenantId,
      key: `exec-${roleSeq++}-${Date.now()}`,
      name,
      rank: 60,
      defaultScope: 'OWN',
    },
  });
  const user = await createWorkspaceUser({
    tenantId: fixture.a.tenantId,
    roleId: role.id,
    email: `exec-${roleSeq}-${Date.now()}@example.com`,
    fullName: name,
  });
  const membership = await prisma.workspaceMembership.findUniqueOrThrow({
    where: { salesUserId: user.id },
    select: { id: true, platformUserId: true },
  });
  await prisma.platformUser.update({
    where: { id: membership.platformUserId },
    data: {
      passwordHash: await hashPassword(PASSWORD),
      phone: '+971500000000',
      avatarUrl: 'https://example.invalid/a.png',
      mfaEnabled: true,
      mfaSecret: encryptSecret('JBSWY3DPEHPK3PXP'),
      mfaRecoveryCodes: ['code-one', 'code-two'],
    },
  });
  await prisma.platformSession.create({
    data: {
      platformUserId: membership.platformUserId,
      tokenHash: `hash-${Math.random().toString(36).slice(2)}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  await prisma.passwordHistory.create({
    data: { platformUserId: membership.platformUserId, passwordHash: await hashPassword('old-password-1') },
  });
  ownedPlatformUserIds.add(membership.platformUserId);
  return { user, ...membership };
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
});

afterAll(async () => {
  await prisma.accountDeletionRequest.deleteMany({
    where: { platformUserId: { in: [...ownedPlatformUserIds] } },
  });
  await fixture.cleanup();
});

describe('erasure', () => {
  it('removes the credential, the second factor, the sessions and the personal profile', async () => {
    const person = await makePerson('Erasure Subject');
    const ctx = ctxFor(fixture.a.tenantId, person.user.id);
    const request = await requestAccountDeletion(ctx, { password: PASSWORD, mfaCode: undefined, reason: 'done' }).catch(
      async () => {
        // The account has a second factor, so a code is required. Disable it for this
        // case: what is under test here is the executor, not the request gate.
        await prisma.platformUser.update({
          where: { id: person.platformUserId },
          data: { mfaEnabled: false },
        });
        return requestAccountDeletion(ctx, { password: PASSWORD, reason: 'done' });
      },
    );

    const result = await processAccountDeletion(request.id);
    expect(result.status, JSON.stringify(result)).toBe('COMPLETED');

    // Read the database back. The outcome object is the executor's own account of
    // itself and is not evidence on its own.
    const after = await prisma.platformUser.findUniqueOrThrow({
      where: { id: person.platformUserId },
      select: {
        passwordHash: true,
        mfaSecret: true,
        mfaEnabled: true,
        mfaRecoveryCodes: true,
        email: true,
        normalizedEmail: true,
        fullName: true,
        phone: true,
        avatarUrl: true,
        status: true,
        deletedAt: true,
      },
    });
    expect(after.passwordHash).toBeNull();
    expect(after.mfaSecret).toBeNull();
    expect(after.mfaEnabled).toBe(false);
    expect(after.mfaRecoveryCodes).toEqual([]);
    expect(after.phone).toBeNull();
    expect(after.avatarUrl).toBeNull();
    expect(after.fullName).toBe('Deleted account');
    expect(after.email).toBe(`deleted-${person.platformUserId}@deleted.invalid`);
    expect(after.normalizedEmail).toBe(`deleted-${person.platformUserId}@deleted.invalid`);
    expect(after.status).toBe('DEACTIVATED');
    expect(after.deletedAt).not.toBeNull();

    expect(await prisma.platformSession.count({ where: { platformUserId: person.platformUserId } })).toBe(0);
    expect(await prisma.passwordHistory.count({ where: { platformUserId: person.platformUserId } })).toBe(0);

    // The membership ends; the workspace-side record is soft-deleted rather than
    // erased, because the records it authored belong to the customer.
    const membership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { id: person.id },
      select: { status: true, removedAt: true },
    });
    expect(membership.status).toBe('REMOVED');
    expect(membership.removedAt).not.toBeNull();
    const workspaceUser = await prisma.user.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, id: person.user.id, deletedAt: { not: null } },
      select: { status: true },
    });
    expect(workspaceUser.status).toBe('DEACTIVATED');
  });

  it('is idempotent: a second run changes nothing and is not an error', async () => {
    const person = await makePerson('Twice Run');
    await prisma.platformUser.update({ where: { id: person.platformUserId }, data: { mfaEnabled: false } });
    const ctx = ctxFor(fixture.a.tenantId, person.user.id);
    const request = await requestAccountDeletion(ctx, { password: PASSWORD });

    const first = await processAccountDeletion(request.id);
    expect(first.status, JSON.stringify(first)).toBe('COMPLETED');
    const completedAt = (
      await prisma.accountDeletionRequest.findUniqueOrThrow({
        where: { id: request.id },
        select: { completedAt: true },
      })
    ).completedAt;

    const second = await processAccountDeletion(request.id);
    expect(second.status).toBe('SKIPPED');
    // The completion time does not move: a redelivered job must not rewrite the record
    // of when the erasure actually happened.
    expect(
      (
        await prisma.accountDeletionRequest.findUniqueOrThrow({
          where: { id: request.id },
          select: { completedAt: true },
        })
      ).completedAt,
    ).toEqual(completedAt);
  });

  it('resumes an interrupted run rather than leaving it stuck', async () => {
    const person = await makePerson('Interrupted');
    await prisma.platformUser.update({ where: { id: person.platformUserId }, data: { mfaEnabled: false } });
    const ctx = ctxFor(fixture.a.tenantId, person.user.id);
    const request = await requestAccountDeletion(ctx, { password: PASSWORD });

    // A worker that claimed the job and died: IN_PROGRESS, started long enough ago to
    // be stale. A fresh run must pick it up and finish.
    await prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const result = await processAccountDeletion(request.id);
    expect(result.status, JSON.stringify(result)).toBe('COMPLETED');
    expect(
      (await prisma.platformUser.findUniqueOrThrow({ where: { id: person.platformUserId } })).passwordHash,
    ).toBeNull();
  });

  it('refuses to claim a job another worker is actively holding', async () => {
    const person = await makePerson('Contended');
    await prisma.platformUser.update({ where: { id: person.platformUserId }, data: { mfaEnabled: false } });
    const ctx = ctxFor(fixture.a.tenantId, person.user.id);
    const request = await requestAccountDeletion(ctx, { password: PASSWORD });

    // Claimed seconds ago, not stale: a second worker must leave it alone rather than
    // run the erasure twice in parallel.
    await prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
    const result = await processAccountDeletion(request.id);
    expect(result.status).toBe('SKIPPED');
    // Untouched: the credential is still there because nothing ran.
    expect(
      (await prisma.platformUser.findUniqueOrThrow({ where: { id: person.platformUserId } })).passwordHash,
    ).not.toBeNull();
  });

  it('a cancellation that lands first stops the erasure entirely', async () => {
    const person = await makePerson('Changed Mind');
    await prisma.platformUser.update({ where: { id: person.platformUserId }, data: { mfaEnabled: false } });
    const ctx = ctxFor(fixture.a.tenantId, person.user.id);
    const request = await requestAccountDeletion(ctx, { password: PASSWORD });

    await cancelAccountDeletion(ctx);
    const result = await processAccountDeletion(request.id);
    expect(result.status).toBe('SKIPPED');

    // Nothing erased, and the account can still sign in.
    const after = await prisma.platformUser.findUniqueOrThrow({
      where: { id: person.platformUserId },
      select: { passwordHash: true, status: true, deletedAt: true },
    });
    expect(after.passwordHash).not.toBeNull();
    expect(after.status).toBe('ACTIVE');
    expect(after.deletedAt).toBeNull();
  });

  // Named for what it does. It sets isPrimaryAdmin, so it proves the PRIMARY_ADMIN
  // blocker; LAST_ADMIN is a different rule with its own case in account-deletion.spec.ts,
  // and "stays retryable" is proved by the sweep, not here.
  it('stops when the person became the workspace owner between asking and being processed', async () => {
    const person = await makePerson('Promoted Meanwhile');
    await prisma.platformUser.update({ where: { id: person.platformUserId }, data: { mfaEnabled: false } });
    const ctx = ctxFor(fixture.a.tenantId, person.user.id);
    const request = await requestAccountDeletion(ctx, { password: PASSWORD });
    expect(request.status).toBe('REQUESTED');

    // Between asking and being processed they become the workspace's named owner.
    await prisma.workspaceMembership.update({ where: { id: person.id }, data: { isPrimaryAdmin: true } });

    const result = await processAccountDeletion(request.id);
    expect(result.status, JSON.stringify(result)).toBe('BLOCKED');

    // Nothing erased: erasing them would have locked the workspace out of its own data.
    const after = await prisma.platformUser.findUniqueOrThrow({
      where: { id: person.platformUserId },
      select: { passwordHash: true, deletedAt: true },
    });
    expect(after.passwordHash).not.toBeNull();
    expect(after.deletedAt).toBeNull();

    const row = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, blockedReason: true },
    });
    expect(row.status).toBe('BLOCKED');
    expect(row.blockedReason).toContain(fixture.a.slug);

    await prisma.workspaceMembership.update({ where: { id: person.id }, data: { isPrimaryAdmin: false } });
  });
});
