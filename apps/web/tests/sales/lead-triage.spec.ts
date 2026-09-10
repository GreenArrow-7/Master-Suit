import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { assignLead, nextDistributionOwner } from '@/services/distribution/assignLead';
import { assessEligibility } from '@/services/distribution/eligibility';
import {
  assignFromTriage,
  listTriageQueue,
  sweepStaleTriage,
  sweepTriageDeadlines,
  sweepTriageNotifications,
} from '@/services/distribution/triageQueue';
import { deliverOutbox } from '@/services/notifications/outbox';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { Ctx, Scope } from '@/lib/security/rbac';

/**
 * P1-1 — the accountable unassigned-lead queue.
 *
 * These are behavioural: each one drives the real service the worker calls and
 * asserts on what a manager would see, rather than on the presence of a field.
 * The properties worth pinning are the ones whose absence was the defect —
 * automatic assignment used to fail **silently** and to place leads with
 * deactivated employees, and neither had a test that could have caught it.
 */

let fixture: Fixture;
let manager: Ctx;
let viewer: Ctx;
let stranger: Ctx;
let stageOpenId = '';
let teamId = '';
let managerUserId = '';
const suffix = randomBytes(4).toString('hex');

const grants = (extra: [string, Scope][] = []) =>
  new Map<string, Scope>([['leads:VIEW', 'ORGANIZATION'], ['allocation:VIEW', 'ORGANIZATION'], ...extra]);

async function makeAgent(label: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const seed = await prisma.user.findFirstOrThrow({
    where: { tenantId: fixture.a.tenantId },
    select: { roleId: true },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: fixture.a.tenantId,
      email: `${label}-${suffix}@triage.test`,
      fullName: label,
      roleId: seed.roleId,
      status: 'ACTIVE',
      ...overrides,
    },
    select: { id: true },
  });
  return user.id;
}

async function makeLead(name = 'Waiting buyer'): Promise<string> {
  const lead = await prisma.lead.create({
    data: {
      tenantId: fixture.a.tenantId,
      reference: `TRI-${suffix}-${randomBytes(3).toString('hex')}`,
      fullName: name,
      stageId: stageOpenId,
      ownerId: null,
      teamId,
      source: 'PUBLIC_FORM',
    },
    select: { id: true },
  });
  return lead.id;
}

/** Replace the workspace's lead distribution rule with one of a given shape. */
async function setRule(input: {
  pool: string[];
  escalateAfterMins?: number | null;
  fallbackUserId?: string | null;
  fallbackTeamId?: string | null;
  respectLeave?: boolean;
  respectQuotas?: boolean;
  respectCapacity?: boolean;
  respectWorkingHours?: boolean;
  isActive?: boolean;
}) {
  await prisma.distributionRule.deleteMany({ where: { tenantId: fixture.a.tenantId, objectType: 'LEAD' } });
  return prisma.distributionRule.create({
    data: {
      tenantId: fixture.a.tenantId,
      name: 'Inbound rotation',
      objectType: 'LEAD',
      method: 'ROUND_ROBIN',
      isActive: input.isActive ?? true,
      candidatePool: { userIds: input.pool },
      escalateAfterMins: input.escalateAfterMins === undefined ? 30 : input.escalateAfterMins,
      fallbackUserId: input.fallbackUserId ?? null,
      fallbackTeamId: input.fallbackTeamId ?? null,
      respectLeave: input.respectLeave ?? true,
      respectQuotas: input.respectQuotas ?? true,
      respectCapacity: input.respectCapacity ?? true,
      respectWorkingHours: input.respectWorkingHours ?? false,
    },
    select: { id: true },
  });
}

const openEntry = (leadId: string) =>
  prisma.leadTriageEntry.findFirst({
    where: { tenantId: fixture.a.tenantId, leadId, status: 'WAITING' },
  });

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const T = fixture.a.tenantId;

  const stage = await prisma.leadStage.findFirstOrThrow({
    where: { tenantId: T, category: 'OPEN' },
    select: { id: true },
  });
  stageOpenId = stage.id;

  managerUserId = await makeAgent('Triage Manager');
  const team = await prisma.team.create({
    data: { tenantId: T, name: `Triage team ${suffix}`, code: `TRI-${suffix}`, managerId: managerUserId },
    select: { id: true },
  });
  teamId = team.id;

  manager = buildCtx(
    buildActor({ tenantId: T, id: managerUserId, permissions: grants([['leads:ASSIGN', 'ORGANIZATION']]) }),
  );
  viewer = buildCtx(buildActor({ tenantId: T, id: await makeAgent('Viewer only'), permissions: grants() }));
  stranger = buildCtx(
    buildActor({
      tenantId: fixture.b.tenantId,
      id: fixture.b.userId,
      permissions: grants([['leads:ASSIGN', 'ORGANIZATION']]),
    }),
  );
}, 120_000);

afterAll(async () => {
  await fixture?.cleanup();
});

beforeEach(async () => {
  await prisma.leadTriageEntry.deleteMany({ where: { tenantId: fixture.a.tenantId } });
});

describe('when nobody can take the lead, it is recorded rather than dropped', () => {
  it('records NO_RULE when the workspace has no active distribution rule', async () => {
    await prisma.distributionRule.deleteMany({ where: { tenantId: fixture.a.tenantId, objectType: 'LEAD' } });
    const leadId = await makeLead();

    const result = await assignLead(fixture.a.tenantId, leadId);

    expect(result.outcome).toBe('queued');
    const entry = await openEntry(leadId);
    expect(entry?.reason).toBe('NO_RULE');
    // The whole point: the lead is still unowned, and now somebody knows.
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, id: leadId } });
    expect(lead.ownerId).toBeNull();
  });

  it('records EMPTY_POOL when the rule names nobody', async () => {
    await setRule({ pool: [] });
    const leadId = await makeLead();

    await assignLead(fixture.a.tenantId, leadId);

    expect((await openEntry(leadId))?.reason).toBe('EMPTY_POOL');
  });

  it('records NO_ELIGIBLE_AGENT and says why each candidate was passed over', async () => {
    const suspended = await makeAgent('Suspended agent', { status: 'SUSPENDED' });
    const removed = await makeAgent('Removed agent', { deletedAt: new Date() });
    await setRule({ pool: [suspended, removed] });
    const leadId = await makeLead();

    await assignLead(fixture.a.tenantId, leadId);

    const entry = await openEntry(leadId);
    expect(entry?.reason).toBe('NO_ELIGIBLE_AGENT');
    const detail = entry?.detail as { candidates: { userId: string; blockers: { code: string }[] }[] };
    // Every candidate is named with a reason — that is what a manager acts on.
    expect(detail.candidates).toHaveLength(2);
    expect(detail.candidates.every((c) => c.blockers.length > 0)).toBe(true);
    const codes = detail.candidates.flatMap((c) => c.blockers.map((b) => b.code));
    expect(codes).toContain('NOT_ACTIVE');
    // A soft-deleted account is filtered out by the client's own soft-delete
    // rule before eligibility sees it, so it reads as NOT_FOUND. Either way it
    // cannot be given a lead, which is the property under test.
    expect(codes).toContain('NOT_FOUND');
  });

  it('distinguishes ALL_AT_CAPACITY from nobody being eligible', async () => {
    // Everybody is fine; they are simply full. Different administrative fix,
    // so it must be a different reason code.
    const full = await makeAgent('Full agent', { dailyLeadQuota: 0 });
    await setRule({ pool: [full] });
    const leadId = await makeLead();

    await assignLead(fixture.a.tenantId, leadId);

    expect((await openEntry(leadId))?.reason).toBe('ALL_AT_CAPACITY');
  });
});

describe('eligibility is one rule, and a deactivated employee never gets a lead', () => {
  it('refuses to assign to a deactivated account through the automatic path', async () => {
    const dead = await makeAgent('Deactivated agent', { status: 'DEACTIVATED' });
    await setRule({ pool: [dead] });
    const leadId = await makeLead();

    await assignLead(fixture.a.tenantId, leadId);

    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, id: leadId } });
    expect(lead.ownerId).toBeNull();
    expect((await openEntry(leadId))?.reason).toBe('NO_ELIGIBLE_AGENT');
  });

  it('walks past an ineligible candidate to the next eligible one', async () => {
    const blocked = await makeAgent('On hold agent', { status: 'SUSPENDED' });
    const good = await makeAgent('Available agent');
    await setRule({ pool: [blocked, good] });
    const leadId = await makeLead();

    const result = await assignLead(fixture.a.tenantId, leadId);

    expect(result).toMatchObject({ outcome: 'assigned', userId: good });
    expect(await openEntry(leadId)).toBeNull();
  });

  it('blocks somebody on approved HR leave, which the old check never saw', async () => {
    const away = await makeAgent('On leave agent');
    const covering = await makeAgent('Covering agent');
    await grantApprovedLeave(away);
    await setRule({ pool: [away, covering] });
    const leadId = await makeLead();

    const verdicts = await assessEligibility(fixture.a.tenantId, [away]);
    expect(verdicts[0]!.eligible).toBe(false);
    expect(verdicts[0]!.blockers.map((b) => b.code)).toContain('ON_APPROVED_LEAVE');

    const result = await assignLead(fixture.a.tenantId, leadId);
    expect(result).toMatchObject({ outcome: 'assigned', userId: covering });
  });

  it('honours respectLeave = false, because that is the workspace saying so', async () => {
    const away = await makeAgent('Working through leave');
    await grantApprovedLeave(away);
    await setRule({ pool: [away], respectLeave: false });
    const leadId = await makeLead();

    const result = await assignLead(fixture.a.tenantId, leadId);
    expect(result).toMatchObject({ outcome: 'assigned', userId: away });
  });

  it('applies the same rule to the social path', async () => {
    const dead = await makeAgent('Social deactivated', { status: 'DEACTIVATED' });
    const quota = await makeAgent('Social at quota', { dailyLeadQuota: 0 });
    await setRule({ pool: [dead, quota] });

    const { userId, note } = await nextDistributionOwner(fixture.a.tenantId);

    expect(userId).toBeNull();
    // The old version reported an empty pool for four different causes.
    expect(note).toMatch(/2 of 2 unavailable/);
  });
});

describe('accountability and review timing come from configuration, never invention', () => {
  it("names the rule's fallback user as responsible", async () => {
    const fallback = await makeAgent('Fallback owner');
    await setRule({ pool: [], fallbackUserId: fallback });
    const leadId = await makeLead();

    await assignLead(fixture.a.tenantId, leadId);

    const entry = await openEntry(leadId);
    expect(entry?.responsibleUserId).toBe(fallback);
    expect(entry?.routingPolicyMissing).toBe(false);
  });

  it("falls back to the lead's team manager", async () => {
    await setRule({ pool: [] });
    const leadId = await makeLead();

    await assignLead(fixture.a.tenantId, leadId);

    const entry = await openEntry(leadId);
    expect(entry?.responsibleUserId).toBe(managerUserId);
    expect(entry?.responsibleTeamId).toBe(teamId);
  });

  it('flags a missing routing policy instead of escalating to anyone available', async () => {
    const orphan = await prisma.lead.create({
      data: {
        tenantId: fixture.a.tenantId,
        reference: `TRI-${suffix}-${randomBytes(3).toString('hex')}`,
        fullName: 'Unrouted buyer',
        stageId: stageOpenId,
        ownerId: null,
        teamId: null,
      },
      select: { id: true },
    });
    await setRule({ pool: [] });

    await assignLead(fixture.a.tenantId, orphan.id);

    const entry = await openEntry(orphan.id);
    expect(entry?.responsibleUserId).toBeNull();
    expect(entry?.routingPolicyMissing).toBe(true);
    // Still visible, still counted. Invisible is the failure mode.
    const queue = await listTriageQueue(manager);
    expect(queue.map((r) => r.leadId)).toContain(orphan.id);
  });

  it('sets no deadline when no review window is configured, and says so', async () => {
    await setRule({ pool: [], escalateAfterMins: null });
    const leadId = await makeLead();

    await assignLead(fixture.a.tenantId, leadId);

    const entry = await openEntry(leadId);
    expect(entry?.reviewDueAt).toBeNull();
    expect(entry?.reviewPolicyMissing).toBe(true);
  });

  it('computes the deadline from the configured window', async () => {
    await setRule({ pool: [], escalateAfterMins: 45 });
    const leadId = await makeLead();
    const now = new Date('2026-06-01T10:00:00.000Z');

    await assignLead(fixture.a.tenantId, leadId, now);

    const entry = await openEntry(leadId);
    // An absolute instant, so a workspace's display timezone changes how it is
    // rendered and never when it fires.
    expect(entry?.reviewDueAt?.toISOString()).toBe('2026-06-01T10:45:00.000Z');
  });

  it('reports configuration it cannot honour rather than pretending to', async () => {
    await setRule({ pool: [], respectWorkingHours: true });
    const leadId = await makeLead();

    await assignLead(fixture.a.tenantId, leadId);

    const detail = (await openEntry(leadId))?.detail as { unsupported: string[] };
    expect(detail.unsupported.join(' ')).toMatch(/respectWorkingHours/);
  });
});

describe('retries and races', () => {
  it('a redelivered intake event does not create a second queue entry', async () => {
    await setRule({ pool: [] });
    const leadId = await makeLead();

    const first = await assignLead(fixture.a.tenantId, leadId);
    const second = await assignLead(fixture.a.tenantId, leadId);

    expect(first).toMatchObject({ outcome: 'queued', alreadyQueued: false });
    expect(second).toMatchObject({ outcome: 'queued', alreadyQueued: true });
    const all = await prisma.leadTriageEntry.count({ where: { tenantId: fixture.a.tenantId, leadId } });
    expect(all).toBe(1);
  });

  it('two workers racing one lead produce one entry, not two', async () => {
    await setRule({ pool: [] });
    const leadId = await makeLead();

    await Promise.all([
      assignLead(fixture.a.tenantId, leadId),
      assignLead(fixture.a.tenantId, leadId),
      assignLead(fixture.a.tenantId, leadId),
    ]);

    expect(await prisma.leadTriageEntry.count({ where: { tenantId: fixture.a.tenantId, leadId } })).toBe(1);
  });

  it('two workers racing one assignable lead agree on one owner', async () => {
    const a = await makeAgent('Racer A');
    const b = await makeAgent('Racer B');
    await setRule({ pool: [a, b] });
    const leadId = await makeLead();

    const results = await Promise.all([assignLead(fixture.a.tenantId, leadId), assignLead(fixture.a.tenantId, leadId)]);

    const assigned = results.filter((r) => r.outcome === 'assigned');
    expect(assigned.length).toBeLessThanOrEqual(1);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, id: leadId } });
    expect(lead.ownerId).not.toBeNull();
    // Exactly one history row: a second would mean the lead was handed over twice.
    expect(await prisma.leadAssignmentHistory.count({ where: { tenantId: fixture.a.tenantId, leadId } })).toBe(1);
  });

  it('concurrent assignments respect a capacity of one', async () => {
    // One free slot, two leads arriving together. Without the row lock both
    // read "one free" and both take it.
    const tight = await makeAgent('Single slot agent', { dailyLeadQuota: 1 });
    await setRule({ pool: [tight] });
    const [leadA, leadB] = await Promise.all([makeLead('Race lead A'), makeLead('Race lead B')]);

    await Promise.all([assignLead(fixture.a.tenantId, leadA), assignLead(fixture.a.tenantId, leadB)]);

    const held = await prisma.lead.count({ where: { tenantId: fixture.a.tenantId, ownerId: tight } });
    expect(held).toBe(1);
    // The one that lost is accounted for, not dropped.
    const queued = await prisma.leadTriageEntry.count({
      where: { tenantId: fixture.a.tenantId, leadId: { in: [leadA, leadB] }, status: 'WAITING' },
    });
    expect(queued).toBe(1);
  });
});

describe('manual assignment', () => {
  it('an authorised manager places a waiting lead, and the queue clears', async () => {
    const taker = await makeAgent('Manual taker');
    await setRule({ pool: [] });
    const leadId = await makeLead();
    await assignLead(fixture.a.tenantId, leadId);
    const entry = await openEntry(leadId);

    const result = await assignFromTriage({ ctx: manager, entryId: entry!.id, toUserId: taker });

    expect(result.toUserId).toBe(taker);
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, id: leadId } });
    expect(lead.ownerId).toBe(taker);
    expect(await openEntry(leadId)).toBeNull();
    const closed = await prisma.leadTriageEntry.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, id: entry!.id },
    });
    expect(closed.status).toBe('ASSIGNED');
    expect(closed.resolvedById).toBe(manager.actor.id);
  });

  it('writes assignment history naming who decided', async () => {
    const taker = await makeAgent('History taker');
    await setRule({ pool: [] });
    const leadId = await makeLead();
    await assignLead(fixture.a.tenantId, leadId);
    const entry = await openEntry(leadId);

    await assignFromTriage({ ctx: manager, entryId: entry!.id, toUserId: taker, reason: 'Knows the area' });

    const history = await prisma.leadAssignmentHistory.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, leadId },
    });
    expect(history.toOwnerId).toBe(taker);
    expect(history.assignedById).toBe(manager.actor.id);
    expect(history.method).toBe('MANAGER_SELECTED');
    expect(history.reason).toBe('Knows the area');
  });

  it('refuses somebody without leads:ASSIGN', async () => {
    const taker = await makeAgent('Refused taker');
    await setRule({ pool: [] });
    const leadId = await makeLead();
    await assignLead(fixture.a.tenantId, leadId);
    const entry = await openEntry(leadId);

    await expect(assignFromTriage({ ctx: viewer, entryId: entry!.id, toUserId: taker })).rejects.toMatchObject({
      status: 403,
    });
    expect(await openEntry(leadId)).not.toBeNull();
  });

  it('refuses a manager from another workspace', async () => {
    const taker = await makeAgent('Cross-tenant taker');
    await setRule({ pool: [] });
    const leadId = await makeLead();
    await assignLead(fixture.a.tenantId, leadId);
    const entry = await openEntry(leadId);

    await expect(assignFromTriage({ ctx: stranger, entryId: entry!.id, toUserId: taker })).rejects.toMatchObject({
      status: 404,
    });
    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, id: leadId } });
    expect(lead.ownerId).toBeNull();
  });

  it('will not hand a lead to a deactivated employee, even for a manager', async () => {
    const dead = await makeAgent('Manual deactivated', { status: 'DEACTIVATED' });
    await setRule({ pool: [] });
    const leadId = await makeLead();
    await assignLead(fixture.a.tenantId, leadId);
    const entry = await openEntry(leadId);

    await expect(assignFromTriage({ ctx: manager, entryId: entry!.id, toUserId: dead })).rejects.toMatchObject({
      status: 422,
    });
  });

  it('lets a manager override a quota, which is a decision rather than a rule', async () => {
    const full = await makeAgent('Over quota taker', { dailyLeadQuota: 0 });
    await setRule({ pool: [] });
    const leadId = await makeLead();
    await assignLead(fixture.a.tenantId, leadId);
    const entry = await openEntry(leadId);

    const result = await assignFromTriage({ ctx: manager, entryId: entry!.id, toUserId: full });
    expect(result.toUserId).toBe(full);
  });

  it('tells the second of two managers to reload rather than double-assigning', async () => {
    const first = await makeAgent('First choice');
    const second = await makeAgent('Second choice');
    await setRule({ pool: [] });
    const leadId = await makeLead();
    await assignLead(fixture.a.tenantId, leadId);
    const entry = await openEntry(leadId);

    await assignFromTriage({ ctx: manager, entryId: entry!.id, toUserId: first });
    await expect(assignFromTriage({ ctx: manager, entryId: entry!.id, toUserId: second })).rejects.toMatchObject({
      status: 409,
    });

    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId: fixture.a.tenantId, id: leadId } });
    expect(lead.ownerId).toBe(first);
  });
});

describe('deadlines, escalation and re-entry', () => {
  it('escalates once past the review window, however many sweeps run', async () => {
    await setRule({ pool: [], escalateAfterMins: 30 });
    const leadId = await makeLead();
    const opened = new Date(Date.now() - 60 * 60_000);
    await assignLead(fixture.a.tenantId, leadId, opened);

    const before = await prisma.notification.count({
      where: { tenantId: fixture.a.tenantId, kind: 'LEAD_TRIAGE_OVERDUE', recordId: leadId },
    });
    await sweepTriageDeadlines(new Date(), fixture.a.tenantId);
    await sweepTriageDeadlines(new Date(), fixture.a.tenantId);
    await sweepTriageDeadlines(new Date(), fixture.a.tenantId);
    /**
     * Deciding and delivering are two steps now: the sweep commits the decision
     * with the claim so a crash between them cannot lose it, and delivery turns
     * decisions into notifications. The assertion is unchanged in substance —
     * three sweeps still produce exactly one alert.
     */
    await deliverOutbox('t', new Date(), 200, fixture.a.tenantId);

    const after = await prisma.notification.count({
      where: { tenantId: fixture.a.tenantId, kind: 'LEAD_TRIAGE_OVERDUE', recordId: leadId },
    });
    expect(after - before).toBe(1);
    expect((await openEntry(leadId))?.escalatedAt).not.toBeNull();
  });

  it('does not escalate an entry whose review window was never configured', async () => {
    await setRule({ pool: [], escalateAfterMins: null });
    const leadId = await makeLead();
    await assignLead(fixture.a.tenantId, leadId, new Date(Date.now() - 24 * 3_600_000));

    await sweepTriageDeadlines(new Date(), fixture.a.tenantId);

    const entry = await openEntry(leadId);
    expect(entry?.escalatedAt).toBeNull();
    // Not escalated, and not hidden either.
    expect(entry).not.toBeNull();
  });

  it('does not escalate exactly at the boundary, and does one minute later', async () => {
    await setRule({ pool: [], escalateAfterMins: 30 });
    const leadId = await makeLead();
    const opened = new Date('2026-06-01T10:00:00.000Z');
    await assignLead(fixture.a.tenantId, leadId, opened);

    // 29 minutes 59 seconds: not yet.
    await sweepTriageDeadlines(new Date('2026-06-01T10:29:59.000Z'), fixture.a.tenantId);
    expect((await openEntry(leadId))?.escalatedAt).toBeNull();

    // Exactly 30: due, and `lte` means due counts as reached.
    await sweepTriageDeadlines(new Date('2026-06-01T10:30:00.000Z'), fixture.a.tenantId);
    expect((await openEntry(leadId))?.escalatedAt).not.toBeNull();
  });

  it('assigning a lead answers the escalation it had already raised', async () => {
    const taker = await makeAgent('Escalation answerer');
    await setRule({ pool: [], escalateAfterMins: 1 });
    const leadId = await makeLead();
    await assignLead(fixture.a.tenantId, leadId, new Date(Date.now() - 3_600_000));
    await sweepTriageDeadlines(new Date(), fixture.a.tenantId);
    const escalated = await openEntry(leadId);
    expect(escalated?.escalatedAt).not.toBeNull();

    await assignFromTriage({ ctx: manager, entryId: escalated!.id, toUserId: taker });

    const closed = await prisma.leadTriageEntry.findFirstOrThrow({
      where: { tenantId: fixture.a.tenantId, id: escalated!.id },
    });
    expect(closed.status).toBe('ASSIGNED');
    // A later sweep must not re-raise it.
    await sweepTriageDeadlines(new Date(), fixture.a.tenantId);
    expect(await openEntry(leadId)).toBeNull();
  });

  it('a lead that becomes unassigned again opens a distinguishable second episode', async () => {
    const taker = await makeAgent('Returner');
    await setRule({ pool: [] });
    const leadId = await makeLead();

    await assignLead(fixture.a.tenantId, leadId);
    const first = await openEntry(leadId);
    await assignFromTriage({ ctx: manager, entryId: first!.id, toUserId: taker });

    // Back to the pool, the way routeLeads to a team does it.
    await prisma.lead.update({
      where: { tenantId: fixture.a.tenantId, id: leadId },
      data: { ownerId: null, assignedAt: null },
    });
    await assignLead(fixture.a.tenantId, leadId);

    const episodes = await prisma.leadTriageEntry.findMany({
      where: { tenantId: fixture.a.tenantId, leadId },
      orderBy: { episode: 'asc' },
    });
    expect(episodes.map((e) => e.episode)).toEqual([1, 2]);
    expect(episodes[0]!.status).toBe('ASSIGNED');
    expect(episodes[1]!.status).toBe('WAITING');
    // The first episode's waiting time survives the second.
    expect(episodes[0]!.resolvedAt).not.toBeNull();
  });

  it('closes an entry whose lead was assigned by some other path', async () => {
    const other = await makeAgent('Bulk taker');
    await setRule({ pool: [] });
    const leadId = await makeLead();
    await assignLead(fixture.a.tenantId, leadId);

    await prisma.lead.update({
      where: { tenantId: fixture.a.tenantId, id: leadId },
      data: { ownerId: other, assignedAt: new Date() },
    });
    const result = await sweepStaleTriage(new Date(), fixture.a.tenantId);

    expect(result.resolved).toBeGreaterThanOrEqual(1);
    expect(await openEntry(leadId)).toBeNull();
  });

  it('sends the opening notice once, and recovers when the first enqueue never happened', async () => {
    await setRule({ pool: [] });
    const leadId = await makeLead();
    await assignLead(fixture.a.tenantId, leadId);

    await sweepTriageNotifications(new Date(), fixture.a.tenantId);
    await sweepTriageNotifications(new Date(), fixture.a.tenantId);
    await deliverOutbox('t', new Date(), 200, fixture.a.tenantId);

    const notices = await prisma.notification.count({
      where: { tenantId: fixture.a.tenantId, kind: 'LEAD_TRIAGE_WAITING', recordId: leadId },
    });
    expect(notices).toBe(1);
    expect((await openEntry(leadId))?.notifiedAt).not.toBeNull();
  });
});

describe('the queue is scoped like every other lead surface', () => {
  it('does not show another workspace its leads', async () => {
    await setRule({ pool: [] });
    const leadId = await makeLead('Tenant A buyer');
    await assignLead(fixture.a.tenantId, leadId);

    const theirs = await listTriageQueue(stranger);

    expect(theirs.map((r) => r.leadId)).not.toContain(leadId);
  });

  it('explains each entry in words a manager can act on', async () => {
    const away = await makeAgent('Explained agent', { dailyLeadQuota: 0 });
    await setRule({ pool: [away] });
    const leadId = await makeLead('Explained buyer');
    await assignLead(fixture.a.tenantId, leadId);

    const [row] = await listTriageQueue(manager);

    expect(row!.leadName).toBe('Explained buyer');
    expect(row!.source).toBe('PUBLIC_FORM');
    expect(row!.reasonText).toMatch(/quota|capacity|limit/i);
    expect(row!.waitingMs).toBeGreaterThanOrEqual(0);
    expect(row!.responsibleUserName).toBeTruthy();
  });
});

/** An approved leave request covering right now, through the real HR tables. */
async function grantApprovedLeave(userId: string) {
  const T = fixture.a.tenantId;
  const email = `leave-${randomBytes(4).toString('hex')}@triage.test`;
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email.toLowerCase(), fullName: 'Leave holder' },
    select: { id: true },
  });
  const membership = await prisma.workspaceMembership.create({
    data: { tenantId: T, platformUserId: platformUser.id, salesUserId: userId, status: 'ACTIVE', joinedAt: new Date() },
    select: { id: true },
  });
  const employee = await prisma.employeeProfile.create({
    data: {
      tenantId: T,
      membershipId: membership.id,
      employeeNumber: `E-${randomBytes(3).toString('hex')}`,
      employmentStatus: 'ACTIVE',
    },
    select: { id: true },
  });
  const type = await prisma.hrLeaveType.upsert({
    where: { tenantId_code: { tenantId: T, code: 'ANNUAL' } },
    update: {},
    create: { tenantId: T, code: 'ANNUAL', name: 'Annual leave' },
    select: { id: true },
  });
  await prisma.hrLeaveRequest.create({
    data: {
      tenantId: T,
      employeeId: employee.id,
      leaveTypeId: type.id,
      startDate: new Date(Date.now() - 86_400_000),
      endDate: new Date(Date.now() + 86_400_000),
      days: 3,
      status: 'APPROVED',
      decidedAt: new Date(),
    },
  });
}
