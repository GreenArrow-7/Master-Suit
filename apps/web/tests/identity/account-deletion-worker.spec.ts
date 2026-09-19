import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The real consumer, with execution enabled.
 *
 * Every other suite calls the sweep or the handler directly. This one enqueues an
 * `account-deletions` job on the `maintenance` queue and lets a real BullMQ Worker built by
 * `startMaintenanceWorker` pick it up — the path production takes — then reads the database
 * back and tries to sign in. It runs on its own Redis database index so it can neither
 * consume nor disturb the shared queue's scheduled jobs.
 */
// Parsed, not regexed: a URL with a query string (`/0?family=4`) or a trailing slash defeated
// the end-anchored replace and left the worker on the shared database — where its flushdb
// would have wiped every sibling suite's keys and its Worker consumed the shared queue.
const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/0');
redisUrl.pathname = '/13';
process.env.REDIS_URL = redisUrl.toString();
process.env.ACCOUNT_DELETION_EXECUTION_ENABLED = 'true';

const { Queue, QueueEvents } = await import('bullmq');
const { prisma } = await import('@/lib/db');
const { redis } = await import('@/lib/redis');
const { hashPassword } = await import('@/lib/auth/password');
const { issueApiKey } = await import('@/lib/auth/apiKey');
const { requestAccountDeletion } = await import('@/services/identity/accountDeletion');
const { startMaintenanceWorker } = await import('@/workers/maintenance');
const { POST: login } = await import('@/app/api/v1/auth/login/route');
const { post } = await import('../helpers/request');
const { createWorkspaceUser, seedTwoTenants } = await import('../helpers/fixtures');
type Fixture = Awaited<ReturnType<typeof seedTwoTenants>>;
type Ctx = Parameters<typeof requestAccountDeletion>[0];
type RetainedCategory = { category: string; count: number; reason: string };

const PASSWORD = 'Correct-Horse-Battery-9!';
const ownedPlatformUserIds = new Set<string>();
let fixture: Fixture;
let worker: ReturnType<typeof startMaintenanceWorker>;
let queue: InstanceType<typeof Queue>;
let events: InstanceType<typeof QueueEvents>;

beforeAll(async () => {
  fixture = await seedTwoTenants();
  await redis.flushdb(); // index 13 belongs to this file alone
  queue = new Queue('maintenance', { connection: redis });
  events = new QueueEvents('maintenance', { connection: redis });
  await events.waitUntilReady();
  worker = startMaintenanceWorker();
  await worker.waitUntilReady();
});

afterAll(async () => {
  await worker?.close();
  await queue?.close();
  await events?.close();
  await prisma.accountDeletionRequest.deleteMany({ where: { platformUserId: { in: [...ownedPlatformUserIds] } } });
  await fixture.cleanup();
  await redis.flushdb();
});

describe('request → real worker → completion → revoked access', () => {
  it('erases the account through the queue and the sign-in no longer works', async () => {
    const role = await prisma.role.create({
      data: {
        tenantId: fixture.a.tenantId,
        key: `wk-${Date.now()}`,
        name: 'Worker Path',
        rank: 60,
        defaultScope: 'OWN',
      },
    });
    const email = `worker-${Date.now()}@example.com`;
    const user = await createWorkspaceUser({
      tenantId: fixture.a.tenantId,
      roleId: role.id,
      email,
      fullName: 'Worker Path',
    });
    const { platformUserId } = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { salesUserId: user.id },
      select: { platformUserId: true },
    });
    ownedPlatformUserIds.add(platformUserId);
    await prisma.platformUser.update({
      where: { id: platformUserId },
      data: { passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date(), status: 'ACTIVE' },
    });
    // Things that must stop working: a live session, an API key, a service credential,
    // an access grant, and an open invitation to the same address.
    await prisma.platformSession.create({
      data: {
        platformUserId,
        tokenHash: `wk-${Math.random().toString(36).slice(2)}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const { key } = await issueApiKey(fixture.a.tenantId, 'worker-path', role.id, [], user.id);
    await prisma.platformServiceCredential.create({
      data: {
        platformUserId,
        name: 'svc',
        prefix: `p-${Date.now()}`,
        keyHash: `h-${Math.random().toString(36).slice(2)}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await prisma.platformAccessGrant.create({
      data: {
        tenantId: fixture.b.tenantId,
        platformUserId,
        reason: 'test',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await prisma.workspaceInvitation.create({
      data: {
        tenantId: fixture.a.tenantId,
        email,
        pendingKey: email,
        fullName: 'Worker Path',
        roleId: role.id,
        tokenHash: `inv-${Math.random().toString(36).slice(2)}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    // Sign-in works before.
    const before = await post(login, '/api/v1/auth/login', { email, password: PASSWORD });
    expect(before.status, JSON.stringify(before.body)).toBeLessThan(300);

    const ctx = {
      tenantId: fixture.a.tenantId,
      actor: { id: user.id, permissions: new Map() },
      requestId: 'wk',
      ip: '127.0.0.1',
      userAgent: 'vitest',
    } as unknown as Ctx;
    const request = await requestAccountDeletion(ctx, { password: PASSWORD, reason: 'worker path' });
    expect(request.status).toBe('REQUESTED');

    // The job the scheduler would add, added by hand and scoped to this account. The
    // worker that consumes it is the real one.
    const job = await queue.add('account-deletions', { platformUserIds: [platformUserId] });
    const result = (await job.waitUntilFinished(events, 60_000)) as {
      completed: number;
      disabled: boolean;
    };
    expect(result.disabled).toBe(false);
    expect(result.completed).toBe(1);

    const row = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.status).toBe('COMPLETED');
    const outcome = row.outcome as unknown as {
      sessionsRevoked: number;
      apiKeysRevoked: number;
      serviceCredentialsRevoked: number;
      accessGrantsRevoked: number;
      invitationsRevoked: number;
      retained: RetainedCategory[];
    };
    // Two: the one seeded above and the one the sign-in check just minted.
    expect(outcome.sessionsRevoked).toBe(2);
    expect(outcome.apiKeysRevoked).toBe(1);
    expect(outcome.serviceCredentialsRevoked).toBe(1);
    expect(outcome.accessGrantsRevoked).toBe(1);
    expect(outcome.invitationsRevoked).toBe(1);
    expect(outcome.retained.map((r) => r.category)).toContain('backups');

    // Access is gone: no session rows, key revoked, and the password no longer signs in.
    expect(await prisma.platformSession.count({ where: { platformUserId } })).toBe(0);
    expect(
      await prisma.aPIKey.count({ where: { tenantId: fixture.a.tenantId, createdById: user.id, revokedAt: null } }),
    ).toBe(0);
    expect(key.startsWith('lf_live_')).toBe(true);
    const after = await post(login, '/api/v1/auth/login', { email, password: PASSWORD });
    expect(after.status).toBeGreaterThanOrEqual(400);
    const identity = await prisma.platformUser.findUniqueOrThrow({ where: { id: platformUserId } });
    expect(identity.passwordHash).toBeNull();
    expect(identity.deletedAt).not.toBeNull();
    expect(identity.normalizedEmail).not.toBe(email);
  }, 90_000);
});
