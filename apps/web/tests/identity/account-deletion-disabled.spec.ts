import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The executor with its switch off — which is the default.
 *
 * The retention and scope decisions that say what a completed erasure may remove are the
 * owner's and are not yet recorded. Until they are, a worker built from this branch must
 * record requests and erase nothing. This file sets the variable to '' (what .env.example
 * ships) before anything under src/ is imported, because env.ts parses once at import;
 * vitest.config gives every other file 'true'.
 */
process.env.ACCOUNT_DELETION_EXECUTION_ENABLED = '';

const { prisma } = await import('@/lib/db');
const { hashPassword } = await import('@/lib/auth/password');
const { executionEnabled, processAccountDeletion, requestAccountDeletion, sweepAccountDeletions } =
  await import('@/services/identity/accountDeletion');
const { handleMaintenanceJob } = await import('@/workers/maintenance');
const { createWorkspaceUser, seedTwoTenants } = await import('../helpers/fixtures');
type Fixture = Awaited<ReturnType<typeof seedTwoTenants>>;
type Ctx = Parameters<typeof requestAccountDeletion>[0];

const PASSWORD = 'Correct-Horse-Battery-9!';
const ownedPlatformUserIds = new Set<string>();
let fixture: Fixture;

beforeAll(async () => {
  fixture = await seedTwoTenants();
});

afterAll(async () => {
  await prisma.accountDeletionRequest.deleteMany({ where: { platformUserId: { in: [...ownedPlatformUserIds] } } });
  await fixture.cleanup();
});

async function makePerson() {
  const role = await prisma.role.create({
    data: { tenantId: fixture.a.tenantId, key: `off-${Date.now()}`, name: 'Off', rank: 60, defaultScope: 'OWN' },
  });
  const user = await createWorkspaceUser({
    tenantId: fixture.a.tenantId,
    roleId: role.id,
    email: `off-${Date.now()}@example.com`,
    fullName: 'Switch Off',
  });
  const membership = await prisma.workspaceMembership.findUniqueOrThrow({
    where: { salesUserId: user.id },
    select: { platformUserId: true },
  });
  await prisma.platformUser.update({
    where: { id: membership.platformUserId },
    data: { passwordHash: await hashPassword(PASSWORD) },
  });
  ownedPlatformUserIds.add(membership.platformUserId);
  const ctx = {
    tenantId: fixture.a.tenantId,
    actor: { id: user.id, permissions: new Map() },
    requestId: 'off',
    ip: '127.0.0.1',
    userAgent: 'vitest',
  } as unknown as Ctx;
  return { platformUserId: membership.platformUserId, ctx };
}

describe('with execution disabled (the default)', () => {
  it('is off when the variable is unset or empty', () => {
    expect(executionEnabled()).toBe(false);
  });

  it('records the request but the sweep, the executor and the worker job erase nothing', async () => {
    const person = await makePerson();
    const request = await requestAccountDeletion(person.ctx, { password: PASSWORD });
    expect(request.status).toBe('REQUESTED');

    const sweep = await sweepAccountDeletions(20, [person.platformUserId]);
    expect(sweep).toMatchObject({ considered: 0, completed: 0, disabled: true });

    const direct = await processAccountDeletion(request.id);
    expect(direct).toMatchObject({ status: 'SKIPPED', reason: 'execution disabled' });

    const viaWorker = (await handleMaintenanceJob({
      name: 'account-deletions',
      data: { platformUserIds: [person.platformUserId] },
    })) as { disabled: boolean };
    expect(viaWorker.disabled).toBe(true);

    // Nothing moved: not to IN_PROGRESS, no startedAt, credential intact, identity intact.
    const row = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.status).toBe('REQUESTED');
    expect(row.startedAt).toBeNull();
    const identity = await prisma.platformUser.findUniqueOrThrow({ where: { id: person.platformUserId } });
    expect(identity.passwordHash).not.toBeNull();
    expect(identity.status).toBe('ACTIVE');
    expect(identity.deletedAt).toBeNull();
  });
});
