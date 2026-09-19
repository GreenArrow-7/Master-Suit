import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { issueApiKey } from '@/lib/auth/apiKey';
import { GET, POST } from '@/app/api/v1/workspaces/[workspaceSlug]/identity/self/[action]/route';
import { get, post } from '../helpers/request';
import { createSessionToken } from '../helpers/session';
import { createWorkspaceUser, seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * Authorization at the HTTP boundary, through the real route handler.
 *
 * The service tests prove that `requestAccountDeletion(ctx)` acts on `ctx.actor` and
 * nothing else. They do not prove that the route builds that ctx from the session and
 * ignores whatever the body says — and the earlier "authorization" spec checked that by
 * reading the route's source text for substrings, which an aliased import would satisfy.
 * These send real requests with real cookies, real API keys and forged bodies, and read
 * the database back afterwards.
 */

const PASSWORD = 'Correct-Horse-Battery-9!';
const ownedPlatformUserIds = new Set<string>();
let fixture: Fixture;
let seq = 0;

const path = (slug: string, action: string) => `/api/v1/workspaces/${slug}/identity/self/${action}`;
const params = (slug: string, action: string) => ({ workspaceSlug: slug, action });

async function makeRep(label: string) {
  const role = await prisma.role.create({
    data: {
      tenantId: fixture.a.tenantId,
      key: `http-${seq++}-${Date.now()}`,
      name: label,
      rank: 60,
      defaultScope: 'OWN',
    },
  });
  const user = await createWorkspaceUser({
    tenantId: fixture.a.tenantId,
    roleId: role.id,
    email: `http-${seq}-${Date.now()}@example.com`,
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
  ownedPlatformUserIds.add(membership.platformUserId);
  return {
    user,
    roleId: role.id,
    platformUserId: membership.platformUserId,
    cookie: await createSessionToken(fixture.a.tenantId, user.id),
  };
}

const openRequestsFor = (platformUserId: string) =>
  prisma.accountDeletionRequest.count({
    where: { platformUserId, status: { in: ['REQUESTED', 'BLOCKED', 'IN_PROGRESS'] } },
  });

beforeAll(async () => {
  fixture = await seedTwoTenants();
});

afterAll(async () => {
  await prisma.accountDeletionRequest.deleteMany({
    where: { platformUserId: { in: [...ownedPlatformUserIds] } },
  });
  await fixture.cleanup();
});

describe('who may reach the endpoint at all', () => {
  it('refuses a request with no session', async () => {
    const res = await get(
      GET,
      path(fixture.a.slug, 'account-deletion-status'),
      undefined,
      params(fixture.a.slug, 'account-deletion-status'),
    );
    expect(res.status).toBe(401);
  });

  it('refuses an API key on both arms, and writes nothing', async () => {
    const rep = await makeRep('Key Holder');
    const { key } = await issueApiKey(fixture.a.tenantId, 'probe', rep.roleId, [], rep.user.id);

    // A key authenticates as the person who created it. It must not be able to read
    // whether they asked to be erased, and it must not be able to ask on their behalf.
    const read = await get(
      GET,
      path(fixture.a.slug, 'account-deletion-status'),
      { apiKey: key },
      params(fixture.a.slug, 'account-deletion-status'),
    );
    expect(read.status).toBe(403);

    const write = await post(
      POST,
      path(fixture.a.slug, 'account-deletion-request'),
      { password: PASSWORD },
      { apiKey: key },
      params(fixture.a.slug, 'account-deletion-request'),
    );
    expect(write.status).toBe(403);
    expect(await openRequestsFor(rep.platformUserId)).toBe(0);
  });

  it('refuses a session used against a workspace it does not belong to', async () => {
    const rep = await makeRep('Wrong Door');
    const res = await get(
      GET,
      path(fixture.b.slug, 'account-deletion-status'),
      rep.cookie,
      params(fixture.b.slug, 'account-deletion-status'),
    );
    expect(res.status).toBe(404);
  });
});

describe('whose account the request is about', () => {
  it('acts on the session holder, whatever identifiers the body carries', async () => {
    const me = await makeRep('Asks For Self');
    const other = await makeRep('Named In Body');

    // Every field an attacker might try. The schema for this action declares none of
    // them, so zod strips them; the service reads only ctx.actor. If either of those
    // stopped being true, `other` would have a row and `me` would not.
    const res = await post(
      POST,
      path(fixture.a.slug, 'account-deletion-request'),
      {
        password: PASSWORD,
        platformUserId: other.platformUserId,
        userId: other.user.id,
        actorId: other.user.id,
        email: other.user.email,
      },
      me.cookie,
      params(fixture.a.slug, 'account-deletion-request'),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('REQUESTED');

    expect(await openRequestsFor(me.platformUserId)).toBe(1);
    expect(await openRequestsFor(other.platformUserId)).toBe(0);
    const row = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { id: res.body.id },
      select: { platformUserId: true },
    });
    expect(row.platformUserId).toBe(me.platformUserId);
  });

  it('shows a person only their own request, and lets them cancel only their own', async () => {
    const asker = await makeRep('Has A Request');
    const bystander = await makeRep('Has None');
    const created = await post(
      POST,
      path(fixture.a.slug, 'account-deletion-request'),
      { password: PASSWORD },
      asker.cookie,
      params(fixture.a.slug, 'account-deletion-request'),
    );
    expect(created.status).toBe(200);

    const theirs = await get(
      GET,
      path(fixture.a.slug, 'account-deletion-status'),
      bystander.cookie,
      params(fixture.a.slug, 'account-deletion-status'),
    );
    expect(theirs.status).toBe(200);
    expect(theirs.body.request).toBeNull();

    // Cancel takes no target; a bystander with no request of their own gets nothing to
    // cancel, and the asker's row is untouched.
    const cancel = await post(
      POST,
      path(fixture.a.slug, 'account-deletion-cancel'),
      {},
      bystander.cookie,
      params(fixture.a.slug, 'account-deletion-cancel'),
    );
    expect(cancel.status).toBe(404);
    expect((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe(
      'REQUESTED',
    );

    const mine = await get(
      GET,
      path(fixture.a.slug, 'account-deletion-status'),
      asker.cookie,
      params(fixture.a.slug, 'account-deletion-status'),
    );
    expect(mine.body.request?.id).toBe(created.body.id);
    // What crosses the wire is exactly what the card renders — no reason, no blockers.
    expect(Object.keys(mine.body.request).sort()).toEqual(['blockedReason', 'id', 'requestedAt', 'status']);

    const withdrawn = await post(
      POST,
      path(fixture.a.slug, 'account-deletion-cancel'),
      {},
      asker.cookie,
      params(fixture.a.slug, 'account-deletion-cancel'),
    );
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.status).toBe('CANCELLED');
  });
});

describe('reauthentication at the boundary', () => {
  it('refuses a wrong password and writes nothing', async () => {
    const rep = await makeRep('Typo');
    const res = await post(
      POST,
      path(fixture.a.slug, 'account-deletion-request'),
      { password: 'not-it' },
      rep.cookie,
      params(fixture.a.slug, 'account-deletion-request'),
    );
    expect(res.status).toBe(403);
    expect(await openRequestsFor(rep.platformUserId)).toBe(0);
  });

  it('throttles repeated wrong passwords', async () => {
    // The limit is ten in five minutes, consumed before the password is checked, so a
    // borrowed unlocked laptop gets ten guesses and then a 429 — not unlimited tries.
    const rep = await makeRep('Guesser');
    // The limiter counts in fixed five-minute windows (ratelimit.ts: floor(now / 300 s)).
    // Eleven password verifications under a parallel run take several seconds, and a
    // window boundary inside that loop hands the eleventh attempt a fresh bucket — a 403
    // where a 429 is expected, with nothing wrong in the product. Start only when a full
    // minute of the current window remains; the assertions below are unchanged.
    const windowMs = 300_000;
    const left = windowMs - (Date.now() % windowMs);
    if (left < 60_000) await new Promise((resolve) => setTimeout(resolve, left + 50));
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt++) {
      const res = await post(
        POST,
        path(fixture.a.slug, 'account-deletion-request'),
        { password: `wrong-${attempt}` },
        rep.cookie,
        params(fixture.a.slug, 'account-deletion-request'),
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 403)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(await openRequestsFor(rep.platformUserId)).toBe(0);
  }, 120_000); // the wait above, in the worst case, plus eleven password verifications under load
});
