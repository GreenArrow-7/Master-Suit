import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { prisma, withTx } from '@/lib/db';
import { assignLead } from '@/services/distribution/assignLead';
import { assessEligibility, redactForSales } from '@/services/distribution/eligibility';
import { allocate } from '@/services/distribution/allocation';
import { countBacklog, importBacklog } from '@/services/distribution/triageBacklog';
import { assignFromTriage, sweepTriageDeadlines, sweepTriageNotifications } from '@/services/distribution/triageQueue';
import { deliverOutbox } from '@/services/notifications/outbox';
import { openTriageEntry } from '@/services/distribution/triage';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { buildActor, buildCtx } from '../helpers/ctx';
import type { Ctx, Scope } from '@/lib/security/rbac';

/**
 * P1-1 completion: the backlog, idempotency, crash recovery, privacy, and
 * episode concurrency.
 *
 * Each of these is a claim the previous checkpoint made or implied. They are
 * re-tested here against the code rather than against the description, because
 * three of them turned out not to hold.
 */

let fixture: Fixture;
let manager: Ctx;
let stageOpenId = '';
let stageWonId = '';
let teamId = '';
let managerUserId = '';
const suffix = randomBytes(4).toString('hex');
const T = () => fixture.a.tenantId;

const grants = (extra: [string, Scope][] = []) =>
  new Map<string, Scope>([
    ['leads:VIEW', 'ORGANIZATION'],
    ['allocation:VIEW', 'ORGANIZATION'],
    ['allocation:APPROVE', 'ORGANIZATION'],
    ...extra,
  ]);

async function makeAgent(label: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const seed = await prisma.user.findFirstOrThrow({ where: { tenantId: T() }, select: { roleId: true } });
  const user = await prisma.user.create({
    data: {
      tenantId: T(),
      email: `${label}-${randomBytes(3).toString('hex')}@tc.test`,
      fullName: label,
      roleId: seed.roleId,
      status: 'ACTIVE',
      ...overrides,
    },
    select: { id: true },
  });
  return user.id;
}

async function makeLead(opts: { stageId?: string; deleted?: boolean; owner?: string | null } = {}): Promise<string> {
  const lead = await prisma.lead.create({
    data: {
      tenantId: T(),
      reference: `TC-${suffix}-${randomBytes(3).toString('hex')}`,
      fullName: 'Backlog buyer',
      stageId: opts.stageId ?? stageOpenId,
      ownerId: opts.owner ?? null,
      teamId,
      ...(opts.deleted ? { deletedAt: new Date() } : {}),
    },
    select: { id: true },
  });
  return lead.id;
}

async function setRule(pool: string[], escalateAfterMins: number | null = 30) {
  await prisma.distributionRule.deleteMany({ where: { tenantId: T(), objectType: 'LEAD' } });
  return prisma.distributionRule.create({
    data: {
      tenantId: T(),
      name: 'Completion rotation',
      objectType: 'LEAD',
      method: 'ROUND_ROBIN',
      isActive: true,
      candidatePool: { userIds: pool },
      escalateAfterMins,
      fallbackUserId: managerUserId,
    },
    select: { id: true },
  });
}

const openEntry = (leadId: string) =>
  prisma.leadTriageEntry.findFirst({ where: { tenantId: T(), leadId, status: 'WAITING' } });

beforeAll(async () => {
  fixture = await seedTwoTenants();
  const open = await prisma.leadStage.findFirstOrThrow({
    where: { tenantId: T(), category: 'OPEN' },
    select: { id: true },
  });
  stageOpenId = open.id;
  const won = await prisma.leadStage.findFirst({
    where: { tenantId: T(), category: { not: 'OPEN' } },
    select: { id: true },
  });
  stageWonId =
    won?.id ??
    (
      await prisma.leadStage.create({
        data: { tenantId: T(), key: `won-${suffix}`, name: 'Won', category: 'CONVERSION', position: 99 },
        select: { id: true },
      })
    ).id;

  managerUserId = await makeAgent('Completion Manager');
  const team = await prisma.team.create({
    data: { tenantId: T(), name: `Completion team ${suffix}`, code: `TC-${suffix}`, managerId: managerUserId },
    select: { id: true },
  });
  teamId = team.id;
  manager = buildCtx(
    buildActor({ tenantId: T(), id: managerUserId, permissions: grants([['leads:ASSIGN', 'ORGANIZATION']]) }),
  );
}, 120_000);

afterAll(async () => {
  await fixture?.cleanup();
});

beforeEach(async () => {
  await prisma.leadTriageEntry.deleteMany({ where: { tenantId: T() } });
  await prisma.notificationOutbox.deleteMany({ where: { tenantId: T() } });
  await prisma.idempotentRequest.deleteMany({ where: { tenantId: T() } });
});

// ── §2 ──────────────────────────────────────────────────────────────────────
describe('existing unassigned leads', () => {
  it('counts by lifecycle state without writing anything', async () => {
    await makeLead();
    await makeLead({ stageId: stageWonId });
    await makeLead({ deleted: true });
    const before = await prisma.leadTriageEntry.count({ where: { tenantId: T() } });

    const [report] = (await countBacklog(T())) as [Awaited<ReturnType<typeof countBacklog>>[number]];

    expect(report.eligible).toBeGreaterThanOrEqual(1);
    expect(report.closedStage).toBeGreaterThanOrEqual(1);
    expect(report.deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.leadTriageEntry.count({ where: { tenantId: T() } })).toBe(before);
  });

  it('makes an eligible existing lead visible, without inventing its history', async () => {
    await setRule([]);
    const leadId = await makeLead();

    await importBacklog(T(), { apply: true });

    const entry = await openEntry(leadId);
    expect(entry).not.toBeNull();
    expect(entry!.reason).toBe('PRE_EXISTING');
    // The two claims that must never be made up.
    expect(entry!.historyUnknown).toBe(true);
    const detail = entry!.detail as { assessedAt?: string };
    expect(detail.assessedAt).toBeTruthy();
  });

  it('excludes closed-stage and deleted leads by the existing lifecycle rule', async () => {
    await setRule([]);
    const won = await makeLead({ stageId: stageWonId });
    const gone = await makeLead({ deleted: true });
    const owned = await makeLead({ owner: managerUserId });

    await importBacklog(T(), { apply: true });

    expect(await openEntry(won)).toBeNull();
    expect(await openEntry(gone)).toBeNull();
    expect(await openEntry(owned)).toBeNull();
  });

  it('is repeatable: a second run opens no duplicate episode', async () => {
    await setRule([]);
    const leadId = await makeLead();

    const first = await importBacklog(T(), { apply: true });
    const second = await importBacklog(T(), { apply: true });

    expect(first.imported).toBeGreaterThanOrEqual(1);
    expect(second.imported).toBe(0);
    expect(await prisma.leadTriageEntry.count({ where: { tenantId: T(), leadId } })).toBe(1);
  });

  it('cannot leave an assigned lead carrying a WAITING episode', async () => {
    /**
     * The invariant, raced for real.
     *
     * `importBacklog` scans and writes in one call, so the window cannot be
     * opened from outside it — the assignment has to run *concurrently*. Which
     * one wins is not the point and is not asserted: what must hold either way
     * is that a lead with an owner never carries a WAITING episode, because that
     * is the state that shows a manager work already done.
     */
    await setRule([]);
    const leads = await Promise.all([makeLead(), makeLead(), makeLead(), makeLead()]);

    await Promise.all([
      importBacklog(T(), { apply: true }),
      ...leads.map((id) =>
        prisma.lead.update({ where: { tenantId: T(), id }, data: { ownerId: managerUserId } }).catch(() => null),
      ),
    ]);

    const offending = await prisma.leadTriageEntry.findMany({
      where: { tenantId: T(), status: 'WAITING', lead: { is: { tenantId: T(), ownerId: { not: null } } } },
      select: { leadId: true },
    });
    expect(offending).toEqual([]);
  });

  it('the stale sweep closes any episode a race did leave behind', async () => {
    // The second line of that defence: whatever slips through concurrently is
    // reconciled rather than left to mislead a manager.
    await setRule([]);
    const leadId = await makeLead();
    await importBacklog(T(), { apply: true });
    expect(await openEntry(leadId)).not.toBeNull();

    await prisma.lead.update({ where: { tenantId: T(), id: leadId }, data: { ownerId: managerUserId } });
    const { sweepStaleTriage } = await import('@/services/distribution/triageQueue');
    await sweepStaleTriage(new Date(), T());

    expect(await openEntry(leadId)).toBeNull();
  });

  it('reconciles its counts, and explains what it skipped', async () => {
    await setRule([]);
    await makeLead();
    await makeLead();
    const dry = await importBacklog(T(), { apply: false });
    const run = await importBacklog(T(), { apply: true });

    expect(dry.considered).toBe(run.considered);
    expect(run.imported + run.skipped).toBe(run.considered);
  });
});

// ── §3 ──────────────────────────────────────────────────────────────────────
describe('manual assignment idempotency', () => {
  async function queued(): Promise<{ entryId: string; leadId: string }> {
    await setRule([]);
    const leadId = await makeLead();
    await assignLead(T(), leadId);
    const entry = await openEntry(leadId);
    return { entryId: entry!.id, leadId };
  }

  it('a lost response then a retry returns the original result, not a conflict', async () => {
    const { entryId, leadId } = await queued();
    const taker = await makeAgent('Retry taker');
    const key = `ui:${randomBytes(6).toString('hex')}`;

    // The first call commits. Imagine its HTTP response never arrives.
    const first = await assignFromTriage({ ctx: manager, entryId, toUserId: taker, requestKey: key });
    expect(first.alreadyResolved).toBe(false);

    // The client retries the same logical attempt with the same key.
    const retry = await assignFromTriage({ ctx: manager, entryId, toUserId: taker, requestKey: key });

    expect(retry.leadId).toBe(leadId);
    expect(retry.toUserId).toBe(taker);
    expect(retry.alreadyResolved).toBe(true);
    // One assignment, not two.
    expect(await prisma.leadAssignmentHistory.count({ where: { tenantId: T(), leadId } })).toBe(1);
  });

  it('the same key with a different assignee is a conflict, never a silent win', async () => {
    const { entryId } = await queued();
    const first = await makeAgent('Key first');
    const second = await makeAgent('Key second');
    const key = `ui:${randomBytes(6).toString('hex')}`;

    await assignFromTriage({ ctx: manager, entryId, toUserId: first, requestKey: key });

    await expect(assignFromTriage({ ctx: manager, entryId, toUserId: second, requestKey: key })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('a replay by a different actor is a conflict even when the inputs match', async () => {
    const { entryId } = await queued();
    const taker = await makeAgent('Shared taker');
    const key = `ui:${randomBytes(6).toString('hex')}`;
    await assignFromTriage({ ctx: manager, entryId, toUserId: taker, requestKey: key });

    const other = buildCtx(
      buildActor({
        tenantId: T(),
        id: await makeAgent('Other manager'),
        permissions: grants([['leads:ASSIGN', 'ORGANIZATION']]),
      }),
    );
    await expect(assignFromTriage({ ctx: other, entryId, toUserId: taker, requestKey: key })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('a deliberate new operation gets a new key and is allowed', async () => {
    const a = await queued();
    const b = await queued();
    const taker = await makeAgent('Two-lead taker');

    await assignFromTriage({
      ctx: manager,
      entryId: a.entryId,
      toUserId: taker,
      requestKey: `ui:${randomBytes(6).toString('hex')}`,
    });
    const second = await assignFromTriage({
      ctx: manager,
      entryId: b.entryId,
      toUserId: taker,
      requestKey: `ui:${randomBytes(6).toString('hex')}`,
    });

    expect(second.alreadyResolved).toBe(false);
    expect(await prisma.leadAssignmentHistory.count({ where: { tenantId: T(), leadId: b.leadId } })).toBe(1);
  });

  it('a replay cannot act on a later waiting episode', async () => {
    const { entryId, leadId } = await queued();
    const taker = await makeAgent('Episode taker');
    const key = `ui:${randomBytes(6).toString('hex')}`;
    await assignFromTriage({ ctx: manager, entryId, toUserId: taker, requestKey: key });

    // Back to the pool, and waiting again: a different decision.
    await prisma.lead.update({ where: { tenantId: T(), id: leadId }, data: { ownerId: null, assignedAt: null } });
    await assignLead(T(), leadId);
    const second = await openEntry(leadId);
    expect(second!.id).not.toBe(entryId);

    await expect(
      assignFromTriage({ ctx: manager, entryId: second!.id, toUserId: taker, requestKey: key }),
    ).rejects.toMatchObject({ status: 409 });
    // Still waiting: the replay did not place it.
    expect(await openEntry(leadId)).not.toBeNull();
  });

  it('authorization is checked before the key is ever looked at', async () => {
    const { entryId } = await queued();
    const taker = await makeAgent('Unauthorised target');
    const key = `ui:${randomBytes(6).toString('hex')}`;
    await assignFromTriage({ ctx: manager, entryId, toUserId: taker, requestKey: key });

    const viewer = buildCtx(buildActor({ tenantId: T(), id: await makeAgent('Viewer'), permissions: grants() }));
    // Holding the recorded key must not buy the result.
    await expect(assignFromTriage({ ctx: viewer, entryId, toUserId: taker, requestKey: key })).rejects.toMatchObject({
      status: 403,
    });
  });

  it('an expired key is simply unknown, and the operation guards still refuse', async () => {
    const { entryId, leadId } = await queued();
    const taker = await makeAgent('Expiry taker');
    const key = `ui:${randomBytes(6).toString('hex')}`;
    await assignFromTriage({ ctx: manager, entryId, toUserId: taker, requestKey: key });

    // Age the record past its window.
    await prisma.idempotentRequest.updateMany({
      where: { tenantId: T(), requestKey: key },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // Unknown key → treated as new → refused by the episode's own guard, which
    // is what makes expiry safe rather than a correctness dependency.
    await expect(assignFromTriage({ ctx: manager, entryId, toUserId: taker, requestKey: key })).rejects.toMatchObject({
      status: 409,
    });
    expect(await prisma.leadAssignmentHistory.count({ where: { tenantId: T(), leadId } })).toBe(1);
  });
});

// ── §4 ──────────────────────────────────────────────────────────────────────
describe('notification crash recovery', () => {
  it('a crash after assignment commit still delivers the notice', async () => {
    await setRule([]);
    const leadId = await makeLead();
    await assignLead(T(), leadId);
    const entry = await openEntry(leadId);
    const taker = await makeAgent('Crash taker');

    // The assignment commits. The process dies here — no delivery has run.
    await assignFromTriage({ ctx: manager, entryId: entry!.id, toUserId: taker });
    expect(await prisma.notification.count({ where: { tenantId: T(), userId: taker } })).toBe(0);
    expect(
      await prisma.notificationOutbox.count({ where: { tenantId: T(), status: 'PENDING' } }),
    ).toBeGreaterThanOrEqual(1);

    // A later process picks it up. Nothing was lost.
    await deliverOutbox('recovered-worker', new Date(), 200, T());
    expect(await prisma.notification.count({ where: { tenantId: T(), userId: taker, kind: 'LEAD_ASSIGNED' } })).toBe(1);
  });

  it('a crash after the escalation claim still delivers the alert', async () => {
    await setRule([], 1);
    const leadId = await makeLead();
    await assignLead(T(), leadId, new Date(Date.now() - 3_600_000));

    // Claim + decision commit together; the worker dies before delivery.
    await sweepTriageDeadlines(new Date(), T());
    expect((await openEntry(leadId))!.escalatedAt).not.toBeNull();
    expect(await prisma.notification.count({ where: { tenantId: T(), kind: 'LEAD_TRIAGE_OVERDUE' } })).toBe(0);

    await deliverOutbox('recovered-worker', new Date(), 200, T());
    expect(
      await prisma.notification.count({ where: { tenantId: T(), kind: 'LEAD_TRIAGE_OVERDUE', recordId: leadId } }),
    ).toBe(1);
  });

  it('two concurrent deliveries produce one notification, not two', async () => {
    await setRule([]);
    const leadId = await makeLead();
    await assignLead(T(), leadId);
    await sweepTriageNotifications(new Date(), T());

    await Promise.all([
      deliverOutbox('worker-a', new Date(), 200, T()),
      deliverOutbox('worker-b', new Date(), 200, T()),
      deliverOutbox('worker-c', new Date(), 200, T()),
    ]);

    expect(
      await prisma.notification.count({ where: { tenantId: T(), kind: 'LEAD_TRIAGE_WAITING', recordId: leadId } }),
    ).toBe(1);
  });

  it('delivery and its record commit together, so neither can exist alone', async () => {
    await setRule([]);
    const leadId = await makeLead();
    await assignLead(T(), leadId);
    await sweepTriageNotifications(new Date(), T());

    await deliverOutbox('worker-a', new Date(), 200, T());
    const row = await prisma.notificationOutbox.findFirstOrThrow({
      where: { tenantId: T(), recordId: leadId, kind: 'LEAD_TRIAGE_WAITING' },
    });
    expect(row.status).toBe('DELIVERED');
    expect(row.deliveredAt).not.toBeNull();

    // Re-running claims nothing: the row is no longer PENDING.
    await deliverOutbox('worker-b', new Date(), 200, T());
    expect(
      await prisma.notification.count({ where: { tenantId: T(), kind: 'LEAD_TRIAGE_WAITING', recordId: leadId } }),
    ).toBe(1);
  });

  it('an assignment withdraws an escalation nobody has been told about yet', async () => {
    await setRule([], 1);
    const leadId = await makeLead();
    await assignLead(T(), leadId, new Date(Date.now() - 3_600_000));
    await sweepTriageDeadlines(new Date(), T());
    const entry = await prisma.leadTriageEntry.findFirstOrThrow({ where: { tenantId: T(), leadId } });
    const taker = await makeAgent('Withdraw taker');

    await assignFromTriage({ ctx: manager, entryId: entry.id, toUserId: taker });
    await deliverOutbox('worker-a', new Date(), 200, T());

    // The manager is not paged about a lead that now has an owner.
    expect(
      await prisma.notification.count({ where: { tenantId: T(), kind: 'LEAD_TRIAGE_OVERDUE', recordId: leadId } }),
    ).toBe(0);
    // The agent is still told about their new lead.
    expect(await prisma.notification.count({ where: { tenantId: T(), kind: 'LEAD_ASSIGNED', userId: taker } })).toBe(1);
  });

  it('a delivered notice is never withdrawn', async () => {
    await setRule([], 1);
    const leadId = await makeLead();
    await assignLead(T(), leadId, new Date(Date.now() - 3_600_000));
    await sweepTriageDeadlines(new Date(), T());
    await deliverOutbox('worker-a', new Date(), 200, T());
    expect(
      await prisma.notification.count({ where: { tenantId: T(), kind: 'LEAD_TRIAGE_OVERDUE', recordId: leadId } }),
    ).toBe(1);

    const entry = await prisma.leadTriageEntry.findFirstOrThrow({ where: { tenantId: T(), leadId } });
    await assignFromTriage({ ctx: manager, entryId: entry.id, toUserId: await makeAgent('Late taker') });

    // It happened. Deleting it would make the record lie.
    expect(
      await prisma.notification.count({ where: { tenantId: T(), kind: 'LEAD_TRIAGE_OVERDUE', recordId: leadId } }),
    ).toBe(1);
  });
});

// ── §5 ──────────────────────────────────────────────────────────────────────
describe('allocation and HR privacy boundaries', () => {
  it('bulk allocation refuses a deactivated account', async () => {
    // `headroom` never checked account status, so this path would hand leads to
    // a DEACTIVATED user until the shared rule was applied at the write.
    const dead = await makeAgent('Bulk deactivated', { status: 'DEACTIVATED' });
    await makeLead();
    await makeLead();

    const result = await allocate({ ctx: manager, userIds: [dead], count: 2 });

    expect(result.total).toBe(0);
    expect(await prisma.lead.count({ where: { tenantId: T(), ownerId: dead } })).toBe(0);
  });

  it('bulk allocation cannot exceed a capacity of one under concurrency', async () => {
    const tight = await makeAgent('Bulk single slot', { dailyLeadQuota: 1 });
    await makeLead();
    await makeLead();
    await makeLead();

    await Promise.all([
      allocate({ ctx: manager, userIds: [tight], count: 2 }).catch(() => null),
      allocate({ ctx: manager, userIds: [tight], count: 2 }).catch(() => null),
    ]);

    expect(await prisma.lead.count({ where: { tenantId: T(), ownerId: tight } })).toBe(1);
  });

  it('never writes HR leave details into the Sales-visible queue', async () => {
    const away = await makeAgent('Private agent');
    await grantApprovedLeave(away);
    await setRule([away]);
    const leadId = await makeLead();

    await assignLead(T(), leadId);

    const entry = await openEntry(leadId);
    const raw = JSON.stringify(entry!.detail);
    // The blocker is reported; the HR specifics are not in the row at all.
    expect(raw).toContain('UNAVAILABLE');
    expect(raw).not.toContain('approved leave');
    expect(raw).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(raw).not.toContain('ON_APPROVED_LEAVE');
  });

  it('collapses several HR reasons into one, because the count is a disclosure too', async () => {
    const blockers = [
      { code: 'ON_APPROVED_LEAVE' as const, detail: 'approved leave until 2026-09-18' },
      { code: 'EMPLOYMENT_ENDED' as const, detail: 'employment is terminated' },
      { code: 'AT_CAPACITY' as const, detail: 'holding 40/40 open leads' },
    ];
    const redacted = redactForSales(blockers, false);

    expect(redacted).toHaveLength(2);
    expect(redacted.filter((b) => b.code === 'UNAVAILABLE')).toHaveLength(1);
    // Operational facts survive: a manager needs them and they are not HR data.
    expect(redacted.some((b) => b.code === 'AT_CAPACITY')).toBe(true);
  });

  it('still gives an HR-authorised caller the specifics', async () => {
    const blockers = [{ code: 'ON_APPROVED_LEAVE' as const, detail: 'approved leave until 2026-09-18' }];
    expect(redactForSales(blockers, true)[0]!.detail).toContain('approved leave');
  });

  it('blocks a lead on the day leave starts and releases the day after it ends', async () => {
    const away = await makeAgent('Boundary agent');
    const employeeId = await grantApprovedLeave(away, {
      start: new Date('2026-09-14T00:00:00.000Z'),
      end: new Date('2026-09-16T00:00:00.000Z'),
    });
    expect(employeeId).toBeTruthy();

    // Boundaries are compared as instants in UTC, which is what the columns
    // hold; a workspace's display timezone changes rendering, not the decision.
    const before = await assessEligibility(T(), [away], undefined, new Date('2026-09-13T23:59:59.000Z'));
    const during = await assessEligibility(T(), [away], undefined, new Date('2026-09-15T12:00:00.000Z'));
    const after = await assessEligibility(T(), [away], undefined, new Date('2026-09-16T00:00:01.000Z'));

    expect(before[0]!.eligible).toBe(true);
    expect(during[0]!.eligible).toBe(false);
    expect(after[0]!.eligible).toBe(true);
  });

  it('a team manager sees only their own team’s waiting leads', async () => {
    // Real manager scope, not a workspace administrator.
    await setRule([]);
    const mine = await makeLead();
    const otherTeam = await prisma.team.create({
      data: { tenantId: T(), name: `Other ${suffix}`, code: `OT-${suffix}` },
      select: { id: true },
    });
    const theirs = await prisma.lead.create({
      data: {
        tenantId: T(),
        reference: `TC-${suffix}-${randomBytes(3).toString('hex')}`,
        fullName: 'Other team buyer',
        stageId: stageOpenId,
        ownerId: null,
        teamId: otherTeam.id,
      },
      select: { id: true },
    });
    await assignLead(T(), mine);
    await assignLead(T(), theirs.id);

    const { listTriageQueue } = await import('@/services/distribution/triageQueue');
    const teamManager = buildCtx(
      buildActor({
        tenantId: T(),
        id: managerUserId,
        teamIds: [teamId],
        permissions: new Map<string, Scope>([['leads:VIEW', 'TEAM']]),
      }),
    );
    const seen = await listTriageQueue(teamManager);
    const ids = seen.map((r) => r.leadId);

    expect(ids).not.toContain(theirs.id);
  });
});

// ── §6 ──────────────────────────────────────────────────────────────────────
describe('episode numbering under real concurrency', () => {
  it('three separate connections opening at once produce one episode', async () => {
    /**
     * Separate transactions on separate connections — `Promise.all` over
     * `withTx` gives each its own — so `MAX + 1` genuinely races. The partial
     * unique index decides, and the losers are reported as already queued rather
     * than raising an unexplained server error.
     */
    await setRule([]);
    const leadId = await makeLead();

    const results = await Promise.all([
      withTx(T(), (tx) => openTriageEntry(tx, { tenantId: T(), leadId, reason: 'NO_RULE' })).catch((e) => e),
      withTx(T(), (tx) => openTriageEntry(tx, { tenantId: T(), leadId, reason: 'NO_RULE' })).catch((e) => e),
      withTx(T(), (tx) => openTriageEntry(tx, { tenantId: T(), leadId, reason: 'NO_RULE' })).catch((e) => e),
    ]);

    const rows = await prisma.leadTriageEntry.count({ where: { tenantId: T(), leadId } });
    expect(rows).toBe(1);
    // Whatever raced, nothing escaped as an unhandled error to a caller.
    const opened = results.filter((r) => r && typeof r === 'object' && 'alreadyQueued' in r);
    expect(opened.length).toBeGreaterThanOrEqual(1);
    expect(opened.some((r) => (r as { alreadyQueued: boolean }).alreadyQueued === false)).toBe(true);
  });

  it('re-entry after resolution numbers the next episode, concurrently', async () => {
    await setRule([]);
    const leadId = await makeLead();
    await assignLead(T(), leadId);
    const first = await openEntry(leadId);
    await assignFromTriage({ ctx: manager, entryId: first!.id, toUserId: await makeAgent('Re-entry taker') });
    await prisma.lead.update({ where: { tenantId: T(), id: leadId }, data: { ownerId: null } });

    await Promise.all([
      withTx(T(), (tx) => openTriageEntry(tx, { tenantId: T(), leadId, reason: 'NO_RULE' })).catch(() => null),
      withTx(T(), (tx) => openTriageEntry(tx, { tenantId: T(), leadId, reason: 'NO_RULE' })).catch(() => null),
    ]);

    const all = await prisma.leadTriageEntry.findMany({
      where: { tenantId: T(), leadId },
      orderBy: { episode: 'asc' },
      select: { episode: true, status: true },
    });
    expect(all.map((e) => e.episode)).toEqual([1, 2]);
    expect(all[0]!.status).toBe('ASSIGNED');
    expect(all[1]!.status).toBe('WAITING');
  });

  it('an assignment racing an episode open never leaves both', async () => {
    await setRule([]);
    const leadId = await makeLead();
    await assignLead(T(), leadId);
    const entry = await openEntry(leadId);
    const taker = await makeAgent('Race taker');

    await Promise.all([
      assignFromTriage({ ctx: manager, entryId: entry!.id, toUserId: taker }).catch(() => null),
      withTx(T(), (tx) => openTriageEntry(tx, { tenantId: T(), leadId, reason: 'NO_RULE' })).catch(() => null),
    ]);

    const lead = await prisma.lead.findFirstOrThrow({ where: { tenantId: T(), id: leadId } });
    const waiting = await prisma.leadTriageEntry.count({ where: { tenantId: T(), leadId, status: 'WAITING' } });
    // An owned lead with a WAITING episode is the state the queue must never be
    // in: it shows a manager work that is already done.
    if (lead.ownerId) expect(waiting).toBe(0);
  });
});

/** An approved leave request covering a window, through the real HR tables. */
async function grantApprovedLeave(userId: string, window?: { start: Date; end: Date }): Promise<string> {
  const email = `leave-${randomBytes(4).toString('hex')}@tc.test`;
  const platformUser = await prisma.platformUser.create({
    data: { email, normalizedEmail: email.toLowerCase(), fullName: 'Leave holder' },
    select: { id: true },
  });
  const membership = await prisma.workspaceMembership.create({
    data: {
      tenantId: T(),
      platformUserId: platformUser.id,
      salesUserId: userId,
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
    select: { id: true },
  });
  const employee = await prisma.employeeProfile.create({
    data: {
      tenantId: T(),
      membershipId: membership.id,
      employeeNumber: `E-${randomBytes(3).toString('hex')}`,
      employmentStatus: 'ACTIVE',
    },
    select: { id: true },
  });
  const type = await prisma.hrLeaveType.upsert({
    where: { tenantId_code: { tenantId: T(), code: 'ANNUAL' } },
    update: {},
    create: { tenantId: T(), code: 'ANNUAL', name: 'Annual leave' },
    select: { id: true },
  });
  await prisma.hrLeaveRequest.create({
    data: {
      tenantId: T(),
      employeeId: employee.id,
      leaveTypeId: type.id,
      startDate: window?.start ?? new Date(Date.now() - 86_400_000),
      endDate: window?.end ?? new Date(Date.now() + 86_400_000),
      days: 3,
      status: 'APPROVED',
      decidedAt: new Date(),
    },
  });
  return employee.id;
}
