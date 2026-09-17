import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { cancelAccountDeletion, myDeletionRequest, requestAccountDeletion } from '@/services/identity/accountDeletion';
import { createWorkspaceUser, seedTwoTenants, type Fixture } from '../helpers/fixtures';
import type { Ctx } from '@/lib/security/rbac';

/**
 * Whose request is it.
 *
 * AccountDeletionRequest sits in GLOBAL_MODELS, which exempts it from the tenant guard
 * because an account spans workspaces. That exemption is about *scoping*, and scoping is
 * not authorization — a model the guard ignores is exactly the one where a missing
 * ownership check goes unnoticed, because the usual error never fires.
 *
 * So these read and write across the boundary on purpose: same workspace, different
 * workspace, and a deliberately forged context, asking each time whether one person can
 * see, cancel or influence another's erasure.
 */

const PASSWORD = 'Correct-Horse-Battery-9!';
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

async function makeRep(tenantId: string, label: string) {
  const role = await prisma.role.create({
    data: { tenantId, key: `auth-${seq++}-${Date.now()}`, name: label, rank: 60, defaultScope: 'OWN' },
  });
  const user = await createWorkspaceUser({
    tenantId,
    roleId: role.id,
    email: `auth-${seq}-${Date.now()}@example.com`,
    fullName: label,
  });
  const membership = await prisma.workspaceMembership.findUniqueOrThrow({
    where: { salesUserId: user.id },
    select: { platformUserId: true },
  });
  await prisma.platformUser.update({
    where: { id: membership.platformUserId },
    data: { passwordHash: await hashPassword(PASSWORD) },
  });
  return { user, platformUserId: membership.platformUserId, ctx: ctxFor(tenantId, user.id) };
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
});

afterAll(async () => {
  await prisma.accountDeletionRequest.deleteMany({});
  await fixture.cleanup();
});

describe('one person cannot reach another person’s deletion request', () => {
  it('in the same workspace: B sees nothing of A’s request, and cancelling does not touch it', async () => {
    const a = await makeRep(fixture.a.tenantId, 'Colleague A');
    const b = await makeRep(fixture.a.tenantId, 'Colleague B');

    const aRequest = await requestAccountDeletion(a.ctx, { password: PASSWORD });
    expect(aRequest.status).toBe('REQUESTED');

    // B is in the same workspace and can see A in the people list. B still has no
    // request of their own, and reads none.
    expect(await myDeletionRequest(b.ctx)).toBeNull();

    // B cancelling finds nothing to cancel rather than cancelling A's.
    await expect(cancelAccountDeletion(b.ctx)).rejects.toThrow();

    const stillOpen = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { id: aRequest.id },
      select: { status: true, cancelledAt: true },
    });
    expect(stillOpen.status).toBe('REQUESTED');
    expect(stillOpen.cancelledAt).toBeNull();
  });

  it('across workspaces: a member of B reads and cancels nothing of A’s', async () => {
    const a = await makeRep(fixture.a.tenantId, 'Tenant A person');
    const other = await makeRep(fixture.b.tenantId, 'Tenant B person');

    const aRequest = await requestAccountDeletion(a.ctx, { password: PASSWORD });
    expect(await myDeletionRequest(other.ctx)).toBeNull();
    await expect(cancelAccountDeletion(other.ctx)).rejects.toThrow();

    expect(
      (
        await prisma.accountDeletionRequest.findUniqueOrThrow({
          where: { id: aRequest.id },
          select: { status: true },
        })
      ).status,
    ).toBe('REQUESTED');
  });

  it('each person cancels only their own, when both have one open', async () => {
    const a = await makeRep(fixture.a.tenantId, 'Both A');
    const b = await makeRep(fixture.a.tenantId, 'Both B');

    const aRequest = await requestAccountDeletion(a.ctx, { password: PASSWORD });
    const bRequest = await requestAccountDeletion(b.ctx, { password: PASSWORD });
    expect(aRequest.id).not.toBe(bRequest.id);

    await cancelAccountDeletion(b.ctx);

    // B's is withdrawn; A's is untouched. The services resolve the account from
    // ctx.actor and never from anything the caller supplies, so there is no argument
    // through which B could have named A's row.
    expect(
      (
        await prisma.accountDeletionRequest.findUniqueOrThrow({
          where: { id: bRequest.id },
          select: { status: true },
        })
      ).status,
    ).toBe('CANCELLED');
    expect(
      (
        await prisma.accountDeletionRequest.findUniqueOrThrow({
          where: { id: aRequest.id },
          select: { status: true },
        })
      ).status,
    ).toBe('REQUESTED');
    expect((await myDeletionRequest(a.ctx))?.id).toBe(aRequest.id);
  });

  it('a context naming somebody else’s workspace still only reaches its own account', async () => {
    // The tenantId in a Ctx is the workspace the request arrived through. Pairing A's
    // user id with B's tenant id is not a route a real caller has — `route()` builds
    // both from the session — but if the account were resolved from the tenant rather
    // than from the actor, this is the shape that would expose it.
    const a = await makeRep(fixture.a.tenantId, 'Forged Ctx');
    const aRequest = await requestAccountDeletion(a.ctx, { password: PASSWORD });

    const forged = ctxFor(fixture.b.tenantId, a.user.id);
    const seen = await myDeletionRequest(forged);

    // It resolves to A's own account, because the lookup is membership-by-salesUserId.
    // The point of the case is that it never resolves to anybody *else's*.
    expect(seen?.id).toBe(aRequest.id);

    // And specifically not somebody else's: a second person in the named workspace, with
    // their own open request, which the forged context must not surface.
    const victim = await makeRep(fixture.b.tenantId, 'Not Yours');
    const victimRequest = await requestAccountDeletion(victim.ctx, { password: PASSWORD });
    const seenAgain = await myDeletionRequest(forged);
    expect(seenAgain?.id).toBe(aRequest.id);
    expect(seenAgain?.id).not.toBe(victimRequest.id);

    const rows = await prisma.accountDeletionRequest.findMany({
      where: { id: { in: [aRequest.id, victimRequest.id] } },
      select: { id: true, platformUserId: true },
    });
    expect(rows.find((r) => r.id === aRequest.id)?.platformUserId).toBe(a.platformUserId);
    expect(rows.find((r) => r.id === victimRequest.id)?.platformUserId).toBe(victim.platformUserId);
  });

  it('a signed-in user with no membership cannot reach the feature at all', async () => {
    // A platform identity with no workspace membership: the services refuse rather than
    // falling through to some default account.
    const orphan = ctxFor(fixture.a.tenantId, 'cmu0000000000000000000000');
    await expect(myDeletionRequest(orphan)).rejects.toThrow();
    await expect(requestAccountDeletion(orphan, { password: PASSWORD })).rejects.toThrow();
    await expect(cancelAccountDeletion(orphan)).rejects.toThrow();
  });
});

describe('processing is not reachable from the self-service surface', () => {
  it('the route exposes status, request and cancel — and nothing that processes', async () => {
    // processAccountDeletion takes a request id and performs erasure. It carries no
    // ownership check by design, because its caller is the worker rather than a person,
    // so the thing that must hold is that no HTTP surface hands a user id to it.
    const { readFileSync } = await import('node:fs');
    const route = readFileSync('src/app/api/v1/workspaces/[workspaceSlug]/identity/self/[action]/route.ts', 'utf8');
    expect(route).toContain('account-deletion-status');
    expect(route).toContain('account-deletion-request');
    expect(route).toContain('account-deletion-cancel');
    // The executor must not be importable or callable from this route.
    expect(route).not.toContain('processAccountDeletion');
    // And nothing in the action union may accept an id from the caller.
    expect(route).not.toMatch(/account-deletion-process/);
  });
});
