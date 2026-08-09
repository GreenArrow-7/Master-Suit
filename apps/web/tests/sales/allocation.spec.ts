import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { allocate, headroom, poolDepth, routeLeads } from '@/services/distribution/allocation';
import { askForLeads, cancelRequest, decideRequest, pendingRequests } from '@/services/distribution/requests';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { Ctx, Scope } from '@/lib/security/rbac';

/**
 * M7's tail — allocation, requests and cross-segment routing.
 *
 * The properties worth pinning: quotas that had never been enforced now are,
 * two leaders allocating at once split the pool rather than double-assigning,
 * and an allocation that does less than asked says which limit stopped it.
 */
let fixture: Fixture;
let leader: Ctx;
let agent: Ctx;
let agentB: Ctx;
let stageOpenId = '';
let teamId = '';
const suffix = randomBytes(4).toString('hex');

const perms = (extra: [string, Scope][] = []) =>
  new Map<string, Scope>([
    ['allocation:VIEW', 'ORGANIZATION'],
    ['allocation:CREATE', 'ORGANIZATION'],
    ['leads:VIEW', 'ORGANIZATION'],
    ...extra,
  ]);

/** Fresh unassigned leads sitting in the pool. */
async function pool(n: number) {
  const T = fixture.a.tenantId;
  for (let i = 0; i < n; i++) {
    await prisma.lead.create({
      data: {
        tenantId: T,
        reference: `AL-${suffix}-${randomBytes(3).toString('hex')}`,
        fullName: `Pool lead ${i}`,
        stageId: stageOpenId,
        ownerId: null,
      },
    });
  }
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const T = fixture.a.tenantId;

  const stage = await prisma.leadStage.findFirstOrThrow({
    where: { tenantId: T, category: 'OPEN' },
    select: { id: true },
  });
  stageOpenId = stage.id;

  const seed = await prisma.user.findFirstOrThrow({ where: { tenantId: T }, select: { roleId: true } });
  const makeUser = (label: string, quotas: Record<string, number | null> = {}) =>
    prisma.user.create({
      data: {
        tenantId: T,
        email: `${label}-${suffix}@alloc.test`,
        fullName: label,
        roleId: seed.roleId,
        status: 'ACTIVE',
        ...quotas,
      },
      select: { id: true },
    });

  leader = buildCtx(
    buildActor({
      id: (await makeUser('Leader')).id,
      tenantId: T,
      permissions: perms([['allocation:APPROVE', 'ORGANIZATION']]),
    }),
  );
  agent = buildCtx(buildActor({ id: (await makeUser('Agent')).id, tenantId: T, permissions: perms() }));
  agentB = buildCtx(
    buildActor({ id: (await makeUser('AgentB', { dailyLeadQuota: 2 })).id, tenantId: T, permissions: perms() }),
  );

  const team = await prisma.team.create({
    data: { tenantId: T, name: 'Commercial desk', code: `comm-${suffix}` },
  });
  teamId = team.id;
});

const clear = async () => {
  const T = fixture.a.tenantId;
  await prisma.allocationRequest.deleteMany({ where: { tenantId: T } });
  await prisma.leadAssignmentHistory.deleteMany({ where: { tenantId: T } });
  await prisma.lead.deleteMany({ where: { tenantId: T, reference: { startsWith: `AL-${suffix}` } } });
};

beforeEach(clear);

afterAll(async () => {
  await clear();
  const T = fixture.a.tenantId;
  await prisma.team.deleteMany({ where: { tenantId: T, id: teamId } });
  await prisma.user.deleteMany({ where: { tenantId: T, email: { contains: `-${suffix}@alloc.test` } } });
  await fixture.cleanup();
});

describe('headroom', () => {
  it('means "no limit", not "nothing", when a workspace sets no quota', async () => {
    const [room] = await headroom(fixture.a.tenantId, [agent.actor.id]);
    // Defaulting an unset quota to zero would stop every allocation in a
    // workspace that never configured one.
    expect(room.available).toBeNull();
  });

  it('takes the smallest of the limits that are set', async () => {
    const [room] = await headroom(fixture.a.tenantId, [agentB.actor.id]);
    expect(room.available).toBe(2);
  });

  it('counts against the quota as leads are handed over', async () => {
    await pool(5);
    await allocate({ ctx: leader, userIds: [agentB.actor.id], count: 2 });

    const [room] = await headroom(fixture.a.tenantId, [agentB.actor.id]);
    expect(room.available).toBe(0);
    expect(room.reasons.join(' ')).toMatch(/daily quota reached \(2\/2\)/);
  });

  it('gives nothing to somebody marked unavailable', async () => {
    const T = fixture.a.tenantId;
    await prisma.user.update({ where: { id: agent.actor.id, tenantId: T }, data: { isAvailable: false } });

    const [room] = await headroom(T, [agent.actor.id]);
    expect(room.available).toBe(0);
    expect(room.reasons).toContain('marked unavailable');

    await prisma.user.update({ where: { id: agent.actor.id, tenantId: T }, data: { isAvailable: true } });
  });
});

describe('allocation', () => {
  it('needs the permission', async () => {
    await pool(1);
    await expect(allocate({ ctx: agent, userIds: [agent.actor.id], count: 1 })).rejects.toMatchObject({ status: 403 });
  });

  it('hands out what was asked for when the pool allows', async () => {
    await pool(10);
    const result = await allocate({ ctx: leader, userIds: [agent.actor.id], count: 4 });

    expect(result.total).toBe(4);
    expect(result.allocated[0].leadIds).toHaveLength(4);
    expect(result.poolExhausted).toBe(false);
    expect(await poolDepth(fixture.a.tenantId)).toBe(6);
  });

  it('writes a history row for every lead it moves', async () => {
    await pool(3);
    await allocate({ ctx: leader, userIds: [agent.actor.id], count: 3, reason: 'Monday drop' });

    const rows = await prisma.leadAssignmentHistory.findMany({
      where: { tenantId: fixture.a.tenantId, toOwnerId: agent.actor.id },
    });
    expect(rows).toHaveLength(3);
    expect(rows[0].reason).toBe('Monday drop');
    // A leader chose, rather than a rule firing.
    expect(rows[0].method).toBe('MANAGER_SELECTED');
    expect(rows[0].assignedById).toBe(leader.actor.id);
  });

  it('stops at the quota and says which one stopped it', async () => {
    await pool(10);
    const result = await allocate({ ctx: leader, userIds: [agentB.actor.id], count: 8 });

    // Asked for 8, quota is 2. The difference has to be explainable.
    expect(result.total).toBe(2);
    const again = await allocate({ ctx: leader, userIds: [agentB.actor.id], count: 8 });
    expect(again.total).toBe(0);
    expect(again.skipped[0].reason).toMatch(/daily quota reached/);
  });

  it('reports the pool running dry rather than silently doing less', async () => {
    await pool(2);
    const result = await allocate({ ctx: leader, userIds: [agent.actor.id], count: 10 });
    expect(result.total).toBe(2);
    expect(result.poolExhausted).toBe(true);
  });

  it('fills people in the order given, spilling to the next', async () => {
    await pool(10);
    const result = await allocate({ ctx: leader, userIds: [agentB.actor.id, agent.actor.id], count: 6 });

    // agentB takes 2 (their quota), agent takes the rest.
    expect(result.allocated[0].userId).toBe(agentB.actor.id);
    expect(result.allocated[0].leadIds).toHaveLength(2);
    expect(result.allocated[1].userId).toBe(agent.actor.id);
    expect(result.allocated[1].leadIds).toHaveLength(4);
  });

  it('never hands the same lead to two people under concurrent allocation', async () => {
    await pool(6);

    // Both leaders ask for the whole pool at the same moment. SKIP LOCKED means
    // they split it; without it one would block and then reassign what the
    // other had already given away.
    const [first, second] = await Promise.all([
      allocate({ ctx: leader, userIds: [agent.actor.id], count: 6 }),
      allocate({ ctx: leader, userIds: [agentB.actor.id], count: 6 }),
    ]);

    const ids = [...first.allocated.flatMap((a) => a.leadIds), ...second.allocated.flatMap((a) => a.leadIds)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(6);
  });

  it('leaves another tenant’s pool alone', async () => {
    await pool(3);
    await allocate({ ctx: leader, userIds: [agent.actor.id], count: 3 });
    expect(await poolDepth(fixture.b.tenantId)).toBe(
      await prisma.lead.count({
        where: { tenantId: fixture.b.tenantId, ownerId: null, deletedAt: null, stage: { is: { category: 'OPEN' } } },
      }),
    );
  });
});

describe('allocation requests', () => {
  it('allows one open request at a time', async () => {
    await askForLeads({ ctx: agent, requested: 20 });
    await expect(askForLeads({ ctx: agent, requested: 30 })).rejects.toMatchObject({ status: 409 });
  });

  it('lets the asker withdraw, and nobody else', async () => {
    const request = await askForLeads({ ctx: agent, requested: 20 });
    await expect(cancelRequest({ ctx: agentB, requestId: request.id })).rejects.toMatchObject({ status: 403 });

    const cancelled = await cancelRequest({ ctx: agent, requestId: request.id });
    expect(cancelled.status).toBe('CANCELLED');
    // And the slot is free again.
    await expect(askForLeads({ ctx: agent, requested: 5 })).resolves.toBeTruthy();
  });

  it('allocates as it approves, and records how many actually moved', async () => {
    await pool(10);
    const request = await askForLeads({ ctx: agent, requested: 4 });

    const { request: decided, result } = await decideRequest({ ctx: leader, requestId: request.id, approve: true });
    expect(decided.status).toBe('APPROVED');
    expect(decided.allocatedCount).toBe(4);
    expect(result?.total).toBe(4);
  });

  it('records the shortfall when the asker is at their quota', async () => {
    await pool(10);
    const request = await askForLeads({ ctx: agentB, requested: 9 });

    const { request: decided } = await decideRequest({ ctx: leader, requestId: request.id, approve: true });
    // Approved but only two moved. A request reading APPROVED with nothing
    // recorded is indistinguishable from one nobody looked at.
    expect(decided.allocatedCount).toBe(2);
  });

  it('needs a reason to turn one down', async () => {
    const request = await askForLeads({ ctx: agent, requested: 4 });
    await expect(decideRequest({ ctx: leader, requestId: request.id, approve: false })).rejects.toMatchObject({
      status: 422,
    });

    const { request: decided, result } = await decideRequest({
      ctx: leader,
      requestId: request.id,
      approve: false,
      note: 'Work the ones you have first.',
    });
    expect(decided.status).toBe('REJECTED');
    expect(result).toBeNull();
  });

  it('refuses a second decision on the same request', async () => {
    await pool(5);
    const request = await askForLeads({ ctx: agent, requested: 2 });
    await decideRequest({ ctx: leader, requestId: request.id, approve: true });
    await expect(decideRequest({ ctx: leader, requestId: request.id, approve: true })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('needs the permission to decide', async () => {
    const request = await askForLeads({ ctx: agent, requested: 4 });
    await expect(decideRequest({ ctx: agentB, requestId: request.id, approve: true })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('shows a leader the headroom alongside the ask', async () => {
    await askForLeads({ ctx: agentB, requested: 50 });
    const queue = await pendingRequests(fixture.a.tenantId);
    const row = queue.find((r) => r.requesterId === agentB.actor.id)!;
    // Approving 50 for somebody who can take 2 and then wondering why is the
    // thing this prevents.
    expect(row.headroom?.available).toBe(2);
    expect(row.requesterName).toBe('AgentB');
  });
});

describe('cross-segment routing', () => {
  it('needs a reason and a destination', async () => {
    await pool(1);
    const lead = await prisma.lead.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, reference: { startsWith: `AL-${suffix}` } },
      select: { id: true },
    });

    await expect(routeLeads({ ctx: leader, leadIds: [lead.id], reason: 'x' })).rejects.toMatchObject({ status: 422 });
    await expect(routeLeads({ ctx: leader, leadIds: [lead.id], toTeamId: teamId, reason: '  ' })).rejects.toMatchObject(
      { status: 422 },
    );
    await expect(
      routeLeads({ ctx: leader, leadIds: [lead.id], toTeamId: teamId, toUserId: agent.actor.id, reason: 'both' }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('returns a lead to the destination team’s pool rather than guessing an owner', async () => {
    await pool(2);
    await allocate({ ctx: leader, userIds: [agent.actor.id], count: 2 });
    const leads = await prisma.lead.findMany({
      where: { tenantId: fixture.a.tenantId, ownerId: agent.actor.id },
      select: { id: true },
    });

    await routeLeads({
      ctx: leader,
      leadIds: leads.map((l) => l.id),
      toTeamId: teamId,
      reason: 'Commercial enquiry, not residential',
    });

    const moved = await prisma.lead.findFirstOrThrow({
      where: { id: leads[0].id, tenantId: fixture.a.tenantId },
    });
    // Picking somebody in the destination team would be guessing at their
    // workload from outside it.
    expect(moved.ownerId).toBeNull();
    expect(moved.teamId).toBe(teamId);

    const history = await prisma.leadAssignmentHistory.findFirst({
      where: { tenantId: fixture.a.tenantId, leadId: leads[0].id },
      orderBy: { createdAt: 'desc' },
    });
    expect(history?.fromOwnerId).toBe(agent.actor.id);
    expect(history?.reason).toBe('Commercial enquiry, not residential');
  });

  it('needs the permission', async () => {
    await pool(1);
    const lead = await prisma.lead.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, reference: { startsWith: `AL-${suffix}` } },
      select: { id: true },
    });
    await expect(
      routeLeads({ ctx: agent, leadIds: [lead.id], toTeamId: teamId, reason: 'Wrong desk' }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
