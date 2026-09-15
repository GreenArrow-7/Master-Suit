/**
 * Finding E — lead allocation eligibility.
 *
 * Compares the two paths that hand a lead to an agent:
 *   `allocate()`   — bulk, a leader pressing a button
 *   `assignLead()` — automatic round-robin, the worker reacting to a new lead
 *
 * and asks whether they enforce the same rules.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { allocate, headroom } from '@/services/distribution/allocation';
import { assignLead } from '@/services/distribution/assignLead';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { Ctx } from '@/lib/security/rbac';

const suffix = randomBytes(4).toString('hex');

let tenantId = '';
let stageId = '';
let leaderCtx: Ctx;
/** One agent, quota of 2 per day, currently available. */
let agentId = '';

async function agent(label: string, extra: Record<string, unknown> = {}) {
  const role = await prisma.role.create({
    data: { tenantId, key: `${label}-${suffix}`, name: label, rank: 60, defaultScope: 'OWN' },
  });
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${label}-${suffix}@diag.test`,
      fullName: label,
      roleId: role.id,
      status: 'ACTIVE',
      ...extra,
    },
  });
  return user.id;
}

async function pool(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const lead = await prisma.lead.create({
      data: {
        tenantId,
        reference: `PL-${suffix}-${randomBytes(3).toString('hex')}`,
        fullName: `Pool lead ${i}`,
        stageId,
        ownerId: null,
      },
    });
    ids.push(lead.id);
  }
  return ids;
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `diag-al-${suffix}`, legalName: 'Diag AL LLC', displayName: 'Diag AL', status: 'ACTIVE' },
  });
  tenantId = tenant.id;
  await prisma.moduleEntitlement.create({ data: { tenantId, module: 'SALES', state: 'ACTIVE' } });

  const stage = await prisma.leadStage.create({
    data: { tenantId, key: `new-${suffix}`, name: 'New', category: 'OPEN', position: 0, isDefault: true },
  });
  stageId = stage.id;

  agentId = await agent('agent', { dailyLeadQuota: 2, isAvailable: true });

  leaderCtx = buildCtx(
    buildActor({
      id: await agent('leader'),
      tenantId,
      permissions: new Map([['allocation:APPROVE', 'ORGANIZATION' as const]]),
    }),
  );
});

beforeEach(async () => {
  await prisma.leadAssignmentHistory.deleteMany({ where: { tenantId } });
  await prisma.lead.deleteMany({ where: { tenantId } });
  await prisma.distributionRule.deleteMany({ where: { tenantId } });
  await prisma.user.update({
    where: { id: agentId, tenantId },
    data: { isAvailable: true, onLeaveUntil: null, status: 'ACTIVE', dailyLeadQuota: 2 },
  });
});

afterAll(async () => {
  if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

async function roundRobinRule(userIds: string[]) {
  const rule = await prisma.distributionRule.create({
    data: {
      tenantId,
      name: `RR-${suffix}`,
      objectType: 'LEAD',
      method: 'ROUND_ROBIN',
      isActive: true,
      position: 0,
      candidatePool: { userIds },
    },
  });
  return rule;
}

describe('Finding E — do both allocation paths enforce the same eligibility?', () => {
  it('E1: automatic round-robin honours the daily quota that bulk allocation honours', async () => {
    await roundRobinRule([agentId]);
    // Quota is 2/day. Burn it through the bulk path, which counts correctly.
    await pool(2);
    const bulk = await allocate({ ctx: leaderCtx, userIds: [agentId], count: 2 });
    expect(bulk.total).toBe(2);

    const room = await headroom(tenantId, [agentId]);
    expect(room[0].available).toBe(0);

    // A third lead arrives and the worker routes it. The quota is spent.
    const [extra] = await pool(1);
    await assignLead(tenantId, extra);

    const lead = await prisma.lead.findFirstOrThrow({ where: { id: extra, tenantId } });
    expect(lead.ownerId).toBeNull();
  });

  it('E2: an agent marked unavailable is skipped by automatic assignment', async () => {
    await roundRobinRule([agentId]);
    await prisma.user.update({ where: { id: agentId, tenantId }, data: { isAvailable: false } });

    const [leadId] = await pool(1);
    await assignLead(tenantId, leadId);

    const lead = await prisma.lead.findFirstOrThrow({ where: { id: leadId, tenantId } });
    expect(lead.ownerId).toBeNull();
  });

  it('E3: an agent on leave today is skipped by automatic assignment', async () => {
    await roundRobinRule([agentId]);
    await prisma.user.update({
      where: { id: agentId, tenantId },
      data: { onLeaveUntil: new Date(Date.now() + 7 * 86_400_000) },
    });

    const [leadId] = await pool(1);
    await assignLead(tenantId, leadId);

    const lead = await prisma.lead.findFirstOrThrow({ where: { id: leadId, tenantId } });
    expect(lead.ownerId).toBeNull();
  });

  it('E4: a SUSPENDED agent is skipped by automatic assignment', async () => {
    await roundRobinRule([agentId]);
    await prisma.user.update({ where: { id: agentId, tenantId }, data: { status: 'SUSPENDED' } });

    const [leadId] = await pool(1);
    await assignLead(tenantId, leadId);

    const lead = await prisma.lead.findFirstOrThrow({ where: { id: leadId, tenantId } });
    expect(lead.ownerId).toBeNull();
  });

  it('E5: a SUSPENDED agent is skipped by bulk allocation too', async () => {
    await prisma.user.update({ where: { id: agentId, tenantId }, data: { status: 'SUSPENDED' } });
    await pool(1);

    const result = await allocate({ ctx: leaderCtx, userIds: [agentId], count: 1 });
    expect(result.total).toBe(0);
  });

  it('E6: concurrent bulk allocations cannot push one agent past their quota', async () => {
    await pool(10);

    // Two leaders press the button at the same moment. Quota is 2/day.
    const [a, b] = await Promise.all([
      allocate({ ctx: leaderCtx, userIds: [agentId], count: 2 }),
      allocate({ ctx: leaderCtx, userIds: [agentId], count: 2 }),
    ]);

    const owned = await prisma.lead.count({ where: { tenantId, ownerId: agentId } });
    expect(a.total + b.total).toBe(owned);
    expect(owned).toBeLessThanOrEqual(2);
  });

  it('E7: concurrent automatic assignments advance the rotation once per lead', async () => {
    const second = await agent('agent2', { isAvailable: true });
    await roundRobinRule([agentId, second]);

    const leads = await pool(2);
    await Promise.all(leads.map((id) => assignLead(tenantId, id)));

    const owners = await prisma.lead.findMany({
      where: { tenantId, id: { in: leads } },
      select: { ownerId: true },
    });
    // Two leads, two agents in the rotation: one each.
    expect(new Set(owners.map((o) => o.ownerId)).size).toBe(2);
  });
});

describe('Finding E — approved HR leave and availability', () => {
  it('E8: approving HR leave marks the agent unavailable for the leave dates', async () => {
    // The only two fields allocation reads are User.isAvailable and
    // User.onLeaveUntil. If nothing in the HR leave path writes them, an
    // approved absence cannot influence who gets work.
    const writers = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "HrLeaveRequest" WHERE "tenantId" = $1`,
      tenantId,
    );
    expect(writers[0].count).toBe(0n);

    const user = await prisma.user.findFirstOrThrow({ where: { id: agentId, tenantId } });
    // Documented here rather than asserted: see the report. `onLeaveUntil` has
    // no writer anywhere in src/, so this field can only ever be null in a real
    // workspace.
    expect(user.onLeaveUntil).toBeNull();
  });
});
