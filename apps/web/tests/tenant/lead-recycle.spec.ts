import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { runRecycleSweep } from '@/services/leads/recycle';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';

/**
 * Recycling clears ownership, which makes it the most dangerous sweep in the
 * product: it takes records off people. Every case here is about something it
 * must *not* do.
 *
 * The one that matters most is the default. A workspace that has not set
 * `leadRecycleAfterDays` must come out of a sweep completely untouched — not
 * "mostly", not "only very old ones". A feature that switched itself on at
 * deploy time would rearrange every existing customer's book of work, and no
 * amount of correct behaviour afterwards would undo that.
 */
const DAY_MS = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY_MS);

let pair: Fixture;
let openStageId = '';

/** A lead owned by the workspace's user, with the dormancy fields set. */
async function makeLead(
  tenantId: string,
  ownerId: string,
  stageId: string,
  fields: { lastActivityAt?: Date | null; createdAt?: Date; nextFollowUpAt?: Date | null } = {},
) {
  return prisma.lead.create({
    data: {
      tenantId,
      reference: `RC-${Math.random().toString(36).slice(2, 10)}`,
      fullName: 'Recycle Probe',
      stageId,
      ownerId,
      lastActivityAt: fields.lastActivityAt ?? null,
      nextFollowUpAt: fields.nextFollowUpAt ?? null,
      ...(fields.createdAt ? { createdAt: fields.createdAt } : {}),
    },
  });
}

/**
 * Named with its tenant, because the client's guard refuses a bare `findUnique`
 * by id — the protection working, and not something a fixture should route
 * around.
 */
const ownerOf = async (id: string, tenantId: string) =>
  (await prisma.lead.findFirst({ where: { id, tenantId }, select: { ownerId: true } }))?.ownerId ?? null;

/** Opt a workspace in, or out with null. */
async function setThreshold(tenantId: string, days: number | null) {
  await prisma.organizationSetting.upsert({
    where: { tenantId },
    create: { tenantId, leadRecycleAfterDays: days },
    update: { leadRecycleAfterDays: days },
  });
}

beforeAll(async () => {
  pair = await seedTwoTenants();
  const stage = await prisma.leadStage.findFirst({
    where: { tenantId: pair.a.tenantId, category: 'OPEN' },
    select: { id: true },
  });
  openStageId = stage?.id ?? pair.a.stageId;
}, 120_000);

afterAll(async () => {
  await pair.cleanup();
});

beforeEach(async () => {
  // Both workspaces opted out unless a case says otherwise.
  await setThreshold(pair.a.tenantId, null);
  await setThreshold(pair.b.tenantId, null);
});

describe('a workspace that never opted in', () => {
  it('is left entirely alone, however dormant its leads are', async () => {
    const lead = await makeLead(pair.a.tenantId, pair.a.userId, openStageId, {
      lastActivityAt: ago(9999),
    });

    const result = await runRecycleSweep();

    expect(result.recycled).toBe(0);
    expect(await ownerOf(lead.id, pair.a.tenantId)).toBe(pair.a.userId);
    await prisma.lead.deleteMany({ where: { id: lead.id, tenantId: pair.a.tenantId } });
  });

  /** A threshold of zero would otherwise recycle the entire workspace at once. */
  it('treats a zero or negative threshold as not configured', async () => {
    const lead = await makeLead(pair.a.tenantId, pair.a.userId, openStageId, { lastActivityAt: ago(500) });
    for (const days of [0, -1]) {
      await setThreshold(pair.a.tenantId, days);
      const result = await runRecycleSweep();
      expect(result.recycled).toBe(0);
      expect(await ownerOf(lead.id, pair.a.tenantId)).toBe(pair.a.userId);
    }
    await prisma.lead.deleteMany({ where: { id: lead.id, tenantId: pair.a.tenantId } });
  });
});

describe('a workspace that opted in', () => {
  it('returns a dormant lead to the pool and records why', async () => {
    await setThreshold(pair.a.tenantId, 30);
    const lead = await makeLead(pair.a.tenantId, pair.a.userId, openStageId, { lastActivityAt: ago(90) });

    const result = await runRecycleSweep();
    expect(result.recycled).toBeGreaterThanOrEqual(1);
    expect(await ownerOf(lead.id, pair.a.tenantId)).toBeNull();

    const history = await prisma.leadAssignmentHistory.findFirst({
      where: { tenantId: pair.a.tenantId, leadId: lead.id },
      select: { fromOwnerId: true, toOwnerId: true, reason: true },
    });
    expect(history).toMatchObject({ fromOwnerId: pair.a.userId, toOwnerId: null });
    expect(history?.reason).toContain('30 days');

    // The person who lost it is told, rather than watching it vanish.
    const notice = await prisma.notification.findFirst({
      where: { tenantId: pair.a.tenantId, userId: pair.a.userId, kind: 'lead.recycled', recordId: lead.id },
      select: { channels: true, priority: true },
    });
    expect(notice).not.toBeNull();
    // In-app only: losing an unworked lead is not worth ringing a phone over.
    expect(notice?.channels).toEqual(['in_app']);

    await prisma.lead.deleteMany({ where: { id: lead.id, tenantId: pair.a.tenantId } });
  });

  it('leaves a lead that is still inside the window', async () => {
    await setThreshold(pair.a.tenantId, 30);
    const lead = await makeLead(pair.a.tenantId, pair.a.userId, openStageId, { lastActivityAt: ago(5) });

    await runRecycleSweep();
    expect(await ownerOf(lead.id, pair.a.tenantId)).toBe(pair.a.userId);
    await prisma.lead.deleteMany({ where: { id: lead.id, tenantId: pair.a.tenantId } });
  });

  /**
   * The case that would make the sweep infuriating: an agent who has booked
   * next week's call is working the lead, whatever the activity column says.
   */
  it('never takes a lead that has a follow-up booked ahead', async () => {
    await setThreshold(pair.a.tenantId, 30);
    const lead = await makeLead(pair.a.tenantId, pair.a.userId, openStageId, {
      lastActivityAt: ago(400),
      nextFollowUpAt: new Date(Date.now() + 7 * DAY_MS),
    });

    await runRecycleSweep();
    expect(await ownerOf(lead.id, pair.a.tenantId)).toBe(pair.a.userId);
    await prisma.lead.deleteMany({ where: { id: lead.id, tenantId: pair.a.tenantId } });
  });

  it('falls back to createdAt where lastActivityAt was never written', async () => {
    await setThreshold(pair.a.tenantId, 30);
    const lead = await makeLead(pair.a.tenantId, pair.a.userId, openStageId, {
      lastActivityAt: null,
      createdAt: ago(120),
    });

    await runRecycleSweep();
    expect(await ownerOf(lead.id, pair.a.tenantId)).toBeNull();
    await prisma.lead.deleteMany({ where: { id: lead.id, tenantId: pair.a.tenantId } });
  });

  /** Closed-out records keep their meaning: nothing terminal is reopened. */
  it('does not reopen a lead that was closed out', async () => {
    await setThreshold(pair.a.tenantId, 30);
    const lead = await makeLead(pair.a.tenantId, pair.a.userId, openStageId, { lastActivityAt: ago(400) });
    await prisma.lead.updateMany({
      where: { id: lead.id, tenantId: pair.a.tenantId },
      data: { status: 'ARCHIVED' },
    });

    await runRecycleSweep();
    expect(await ownerOf(lead.id, pair.a.tenantId)).toBe(pair.a.userId);
    await prisma.lead.deleteMany({ where: { id: lead.id, tenantId: pair.a.tenantId } });
  });

  /** Running twice must not produce a second history row for the same move. */
  it('is idempotent across overlapping runs', async () => {
    await setThreshold(pair.a.tenantId, 30);
    const lead = await makeLead(pair.a.tenantId, pair.a.userId, openStageId, { lastActivityAt: ago(90) });

    await runRecycleSweep();
    await runRecycleSweep();

    const history = await prisma.leadAssignmentHistory.count({
      where: { tenantId: pair.a.tenantId, leadId: lead.id },
    });
    expect(history).toBe(1);
    await prisma.lead.deleteMany({ where: { id: lead.id, tenantId: pair.a.tenantId } });
  });
});

describe('tenant isolation', () => {
  it("one workspace opting in does not recycle the other's leads", async () => {
    await setThreshold(pair.a.tenantId, 30);
    await setThreshold(pair.b.tenantId, null);

    const bStage = await prisma.leadStage.findFirst({
      where: { tenantId: pair.b.tenantId, category: 'OPEN' },
      select: { id: true },
    });
    const mine = await makeLead(pair.a.tenantId, pair.a.userId, openStageId, { lastActivityAt: ago(400) });
    const theirs = await makeLead(pair.b.tenantId, pair.b.userId, bStage?.id ?? pair.b.stageId, {
      lastActivityAt: ago(400),
    });

    await runRecycleSweep();

    expect(await ownerOf(mine.id, pair.a.tenantId)).toBeNull();
    expect(await ownerOf(theirs.id, pair.b.tenantId)).toBe(pair.b.userId);

    await prisma.lead.deleteMany({ where: { id: mine.id, tenantId: pair.a.tenantId } });
    await prisma.lead.deleteMany({ where: { id: theirs.id, tenantId: pair.b.tenantId } });
  });
});
