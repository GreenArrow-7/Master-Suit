import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import {
  processAccountDeletion,
  requestAccountDeletion,
  sweepAccountDeletions,
} from '@/services/identity/accountDeletion';
import { handleMaintenanceJob } from '@/workers/maintenance';
import { createWorkspaceUser, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import type { Ctx } from '@/lib/security/rbac';

/**
 * The consumer, and what survives the thing it runs.
 *
 * The executor was correct and unreachable for several revisions: nothing called it, so a
 * request sat at REQUESTED for ever while the UI said it had been accepted. These cover the
 * sweep that drives it, the worker job that schedules the sweep, and — the part no earlier
 * test asserted — that the customer's business records are still there afterwards with the
 * erased person's authorship intact.
 */

const PASSWORD = 'Correct-Horse-Battery-9!';
const ownedPlatformUserIds = new Set<string>();

/**
 * Only this file's accounts.
 *
 * An unscoped sweep erases every open request in the database, and vitest runs these
 * files in parallel against one schema — so this suite was completing the authorization
 * suite's fixtures while that suite was asserting they were still REQUESTED. Scoped
 * teardown fixed the cleanup; this is the read the sweep itself performs mid-test.
 */
function mine() {
  return [...ownedPlatformUserIds];
}
let seq = 0;

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

async function makePerson(label: string) {
  const role = await prisma.role.create({
    data: {
      tenantId: fixture.a.tenantId,
      key: `sweep-${seq++}-${Date.now()}`,
      name: label,
      rank: 60,
      defaultScope: 'OWN',
    },
  });
  const user = await createWorkspaceUser({
    tenantId: fixture.a.tenantId,
    roleId: role.id,
    email: `sweep-${seq}-${Date.now()}@example.com`,
    fullName: label,
  });
  const membership = await prisma.workspaceMembership.findUniqueOrThrow({
    where: { salesUserId: user.id },
    select: { id: true, platformUserId: true },
  });
  await prisma.platformUser.update({
    where: { id: membership.platformUserId },
    data: { passwordHash: await hashPassword(PASSWORD) },
  });
  ownedPlatformUserIds.add(membership.platformUserId);
  return { user, ...membership, ctx: ctxFor(fixture.a.tenantId, user.id) };
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

describe('the sweep that drives the executor', () => {
  it('processes a pending request to COMPLETED', async () => {
    const person = await makePerson('Swept Away');
    const request = await requestAccountDeletion(person.ctx, { password: PASSWORD });

    const tally = await sweepAccountDeletions(20, mine());
    expect(tally.completed).toBeGreaterThanOrEqual(1);

    const row = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: { status: true, completedAt: true },
    });
    expect(row.status).toBe('COMPLETED');
    expect(row.completedAt).not.toBeNull();
    expect(
      (await prisma.platformUser.findUniqueOrThrow({ where: { id: person.platformUserId } })).passwordHash,
    ).toBeNull();
  });

  it('is reachable through the maintenance worker job, not only by direct call', async () => {
    const person = await makePerson('Via Worker');
    const request = await requestAccountDeletion(person.ctx, { password: PASSWORD });

    // The job name the scheduler registers. A handler that silently does not recognise it
    // would log "unknown maintenance job" and return undefined, which is the failure this
    // asserts against.
    const result = (await handleMaintenanceJob({
      name: 'account-deletions',
      data: { platformUserIds: mine() },
    })) as {
      considered: number;
      completed: number;
    };
    expect(result).toBeDefined();
    expect(result.considered).toBeGreaterThanOrEqual(1);

    expect(
      (
        await prisma.accountDeletionRequest.findUniqueOrThrow({
          where: { id: request.id },
          select: { status: true },
        })
      ).status,
    ).toBe('COMPLETED');
  });

  it('one unerasable request does not stop the others', async () => {
    const blocked = await makePerson('Blocked Person');
    const ordinary = await makePerson('Ordinary Person');

    const blockedRequest = await requestAccountDeletion(blocked.ctx, { password: PASSWORD });
    const ordinaryRequest = await requestAccountDeletion(ordinary.ctx, { password: PASSWORD });

    // Becomes the workspace's named owner after asking, so the executor must re-block it.
    await prisma.workspaceMembership.update({ where: { id: blocked.id }, data: { isPrimaryAdmin: true } });

    const tally = await sweepAccountDeletions(20, mine());
    expect(tally.blocked).toBeGreaterThanOrEqual(1);
    expect(tally.completed).toBeGreaterThanOrEqual(1);

    const statuses = await prisma.accountDeletionRequest.findMany({
      where: { id: { in: [blockedRequest.id, ordinaryRequest.id] } },
      select: { id: true, status: true },
    });
    expect(statuses.find((r) => r.id === blockedRequest.id)?.status).toBe('BLOCKED');
    expect(statuses.find((r) => r.id === ordinaryRequest.id)?.status).toBe('COMPLETED');

    await prisma.workspaceMembership.update({ where: { id: blocked.id }, data: { isPrimaryAdmin: false } });
  });

  it('a BLOCKED request completes on the next sweep once ownership is transferred', async () => {
    const person = await makePerson('Transfers Ownership');
    const request = await requestAccountDeletion(person.ctx, { password: PASSWORD });
    await prisma.workspaceMembership.update({ where: { id: person.id }, data: { isPrimaryAdmin: true } });

    await sweepAccountDeletions(20, mine());
    expect(
      (
        await prisma.accountDeletionRequest.findUniqueOrThrow({
          where: { id: request.id },
          select: { status: true },
        })
      ).status,
    ).toBe('BLOCKED');

    // The transfer. Previously this was a dead end: claim took neither BLOCKED nor a fresh
    // request, because the partial index still counted the blocked row as open.
    await prisma.workspaceMembership.update({ where: { id: person.id }, data: { isPrimaryAdmin: false } });

    // A blocked row is re-examined on a cooldown rather than every quarter hour, so the
    // next sweep is not the next tick. Backdating updatedAt is this test standing in for
    // those hours; the impatient path — withdraw and ask again — is a REQUESTED row and
    // needs no wait at all.
    const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.$executeRaw`UPDATE "AccountDeletionRequest" SET "updatedAt" = ${longAgo} WHERE "id" = ${request.id}`;

    await sweepAccountDeletions(20, mine());
    expect(
      (
        await prisma.accountDeletionRequest.findUniqueOrThrow({
          where: { id: request.id },
          select: { status: true },
        })
      ).status,
    ).toBe('COMPLETED');
  });
});

describe('what the customer keeps', () => {
  it('leaves the leads the person created, still attributed to them', async () => {
    const person = await makePerson('Authored Records');
    const stage = await prisma.leadStage.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId },
      select: { id: true },
    });
    const lead = await prisma.lead.create({
      data: {
        tenantId: fixture.a.tenantId,
        reference: `LD-DEL-${Date.now()}`,
        fullName: 'A Customer Of The Workspace',
        stageId: stage.id,
        ownerId: person.user.id,
        createdById: person.user.id,
      },
      select: { id: true },
    });

    const request = await requestAccountDeletion(person.ctx, { password: PASSWORD });
    expect((await processAccountDeletion(request.id)).status).toBe('COMPLETED');

    // The record belongs to the customer, not to the person who typed it. It is still here,
    // still owned by them, and the id still resolves - which is what makes the audit trail
    // readable after the identity is gone.
    const after = await prisma.lead.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, id: lead.id },
      select: { fullName: true, ownerId: true, createdById: true },
    });
    expect(after.fullName).toBe('A Customer Of The Workspace');
    expect(after.ownerId).toBe(person.user.id);
    expect(after.createdById).toBe(person.user.id);

    // The workspace row survives for that attribution, carrying the name and nothing that
    // could still be used to contact them.
    const workspaceUser = await prisma.user.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, id: person.user.id, deletedAt: { not: null } },
      select: { fullName: true, email: true, phone: true, avatarUrl: true },
    });
    expect(workspaceUser.fullName).toBe('Authored Records');
    expect(workspaceUser.email).toBe(`deleted-${person.user.id}@deleted.invalid`);
    expect(workspaceUser.phone).toBeNull();
    expect(workspaceUser.avatarUrl).toBeNull();
  });

  it('records the erasure in the platform audit trail without naming a tenant', async () => {
    const person = await makePerson('Audited Erasure');
    const request = await requestAccountDeletion(person.ctx, { password: PASSWORD });
    await processAccountDeletion(request.id);

    const event = await prisma.platformAuditEvent.findFirst({
      where: { event: 'ACCOUNT_ERASED', objectId: request.id },
      select: { tenantId: true, objectType: true, metadata: true },
    });
    expect(event).not.toBeNull();
    expect(event?.objectType).toBe('account_deletion_request');
    // Null rather than one of the workspaces: the erasure spans every workspace the person
    // belonged to and belongs to none of them.
    expect(event?.tenantId).toBeNull();
    const metadata = event?.metadata as Record<string, unknown>;
    expect(metadata.sessionsRevoked).toBeDefined();
    expect(JSON.stringify(metadata)).not.toContain(fixture.a.slug);
  });
});
