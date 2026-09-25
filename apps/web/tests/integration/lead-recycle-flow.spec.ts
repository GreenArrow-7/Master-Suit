import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTx } from '@/lib/db';
import { seedTwoTenants, type Fixture } from '../helpers/fixtures';
import { findRecyclable, recycleLeads } from '@/services/leads/recycling';

/**
 * Recycling, against the real database.
 *
 * The unit tests prove the rules. These prove the things only a database can:
 * that the "when did it go cold" date really does come out of LeadStageHistory,
 * that one workspace's lost leads never reach another's queue, and that the
 * consent guard holds at the service boundary and not merely in the pure
 * function a caller could forget to consult.
 */

let fixture: Fixture;

/** A lost stage for a tenant, created once and reused. */
async function lostStage(tenantId: string) {
  return withTx(tenantId, async (tx) => {
    const existing = await tx.leadStage.findFirst({
      where: { tenantId, category: 'TERMINAL_NEGATIVE' },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await tx.leadStage.create({
      data: { tenantId, key: 'lost', name: 'Lost', category: 'TERMINAL_NEGATIVE', position: 90 },
      select: { id: true },
    });
    return created.id;
  });
}

/**
 * Put a lead in a lost stage as of `daysAgo`, the way a real transition would:
 * the stage on the row, and the history row that records when it moved.
 */
async function markLost(tenantId: string, leadId: string, stageId: string, daysAgo: number) {
  await withTx(tenantId, async (tx) => {
    const lead = await tx.lead.findFirstOrThrow({ where: { tenantId, id: leadId }, select: { stageId: true } });
    await tx.lead.update({ where: { tenantId, id: leadId }, data: { stageId } });
    await tx.leadStageHistory.create({
      data: {
        tenantId,
        leadId,
        fromStageId: lead.stageId,
        toStageId: stageId,
        createdAt: new Date(Date.now() - daysAgo * 86_400_000),
      },
    });
  });
}

async function setPolicy(tenantId: string, afterDays: number, maxTimes = 2) {
  await prisma.organizationSetting.upsert({
    where: { tenantId },
    update: { leadRecycleAfterDays: afterDays, leadRecycleMaxTimes: maxTimes },
    create: { tenantId, leadRecycleAfterDays: afterDays, leadRecycleMaxTimes: maxTimes },
  });
}

beforeAll(async () => {
  fixture = await seedTwoTenants();
});

afterAll(async () => {
  await fixture.cleanup();
});

describe('lead recycling', () => {
  it('offers a lead that is past the cooling-off period, and explains the one that is not', async () => {
    const { tenantId } = fixture.a;
    const stageId = await lostStage(tenantId);
    await setPolicy(tenantId, 90);

    const [cold, recent] = fixture.a.leadIds;
    await markLost(tenantId, cold!, stageId, 120);
    await markLost(tenantId, recent!, stageId, 10);

    const queue = await findRecyclable(tenantId);
    expect(queue.find((row) => row.id === cold)?.blocked).toBeNull();
    expect(queue.find((row) => row.id === recent)?.blocked).toBe('Cooling off — 80 more days.');
  });

  it('clears the owner, moves the stage and records both', async () => {
    const { tenantId, userId } = fixture.a;
    const stageId = await lostStage(tenantId);
    const leadId = fixture.a.leadIds[0]!;

    await prisma.lead.update({ where: { tenantId, id: leadId }, data: { ownerId: userId } });

    const result = await recycleLeads({ tenantId, actor: { id: userId } }, [leadId]);
    expect(result).toEqual({ recycled: 1, skipped: [] });

    const after = await prisma.lead.findFirstOrThrow({
      where: { tenantId, id: leadId },
      select: { stageId: true, ownerId: true, recycleCount: true, recycledAt: true, subStatusId: true },
    });
    expect(after.stageId).not.toBe(stageId);
    // Handed back to the rotation rather than to a chosen person: the existing
    // distribution rules decide, exactly as they do for a new lead.
    expect(after.ownerId).toBeNull();
    expect(after.recycleCount).toBe(1);
    expect(after.recycledAt).not.toBeNull();
    expect(after.subStatusId).toBeNull();

    const moved = await prisma.leadStageHistory.findFirst({
      where: { tenantId, leadId, fromStageId: stageId },
      orderBy: { createdAt: 'desc' },
      select: { reason: true, changedById: true },
    });
    expect(moved?.reason).toBe('RECYCLED');
    expect(moved?.changedById).toBe(userId);

    const unassigned = await prisma.leadAssignmentHistory.findFirst({
      where: { tenantId, leadId, reason: 'RECYCLED' },
      select: { fromOwnerId: true, toOwnerId: true },
    });
    expect(unassigned).toEqual({ fromOwnerId: userId, toOwnerId: null });
  });

  it('refuses a lead that is no longer in a lost stage', async () => {
    const { tenantId } = fixture.a;
    const leadId = fixture.a.leadIds[0]!; // recycled by the test above, so now open
    const result = await recycleLeads({ tenantId }, [leadId]);
    expect(result.recycled).toBe(0);
    expect(result.skipped[0]?.reason).toMatch(/no longer in a lost stage/i);
  });

  /**
   * The rule this feature exists under. Age is not permission, and the check has
   * to hold here and not only in the pure function — a caller reading a list
   * rendered ten minutes ago must not be able to recycle somebody who ticked
   * "do not call" in between.
   */
  it('never recycles a lead who asked not to be called, however long ago it went cold', async () => {
    const { tenantId } = fixture.a;
    const stageId = await lostStage(tenantId);
    const leadId = fixture.a.leadIds[2]!;

    await markLost(tenantId, leadId, stageId, 900);
    await prisma.lead.update({ where: { tenantId, id: leadId }, data: { doNotCall: true } });

    const queue = await findRecyclable(tenantId);
    expect(queue.find((row) => row.id === leadId)?.blocked).toMatch(/asked not to be called/i);

    const result = await recycleLeads({ tenantId }, [leadId]);
    expect(result.recycled).toBe(0);
    expect(result.skipped[0]?.reason).toMatch(/asked not to be called/i);

    const after = await prisma.lead.findFirstOrThrow({
      where: { tenantId, id: leadId },
      select: { stageId: true, recycleCount: true },
    });
    expect(after.stageId).toBe(stageId);
    expect(after.recycleCount).toBe(0);
  });

  it('stops at the workspace ceiling', async () => {
    const { tenantId } = fixture.a;
    const stageId = await lostStage(tenantId);
    await setPolicy(tenantId, 30, 1);
    const leadId = fixture.a.leadIds[3]!;

    await markLost(tenantId, leadId, stageId, 60);
    expect((await recycleLeads({ tenantId }, [leadId])).recycled).toBe(1);

    // Lost a second time, and long enough ago — but the ceiling is one.
    await markLost(tenantId, leadId, stageId, 60);
    const second = await recycleLeads({ tenantId }, [leadId]);
    expect(second.recycled).toBe(0);
    expect(second.skipped[0]?.reason).toMatch(/already recycled once/i);
  });

  /**
   * A lead lost in January, reopened, and lost again in August cools off from
   * August. Taking the earliest row would recycle it the moment it went cold
   * the second time.
   */
  it('cools off from the most recent loss, not the first', async () => {
    const { tenantId } = fixture.a;
    const stageId = await lostStage(tenantId);
    await setPolicy(tenantId, 90, 5);
    const leadId = fixture.a.leadIds[4]!;

    await markLost(tenantId, leadId, stageId, 400);
    await markLost(tenantId, leadId, stageId, 5);

    const queue = await findRecyclable(tenantId);
    expect(queue.find((row) => row.id === leadId)?.blocked).toMatch(/cooling off/i);
  });

  it('is switched off until a workspace sets a period', async () => {
    const { tenantId } = fixture.b;
    const stageId = await lostStage(tenantId);
    await setPolicy(tenantId, 0);
    const leadId = fixture.b.leadIds[0]!;
    await markLost(tenantId, leadId, stageId, 500);

    const queue = await findRecyclable(tenantId);
    expect(queue.find((row) => row.id === leadId)?.blocked).toMatch(/switched off/i);

    const result = await recycleLeads({ tenantId }, [leadId]);
    expect(result.recycled).toBe(0);
  });

  /**
   * Two brokerages in one city. A queue that showed the other's lost leads
   * would be handing over their book.
   */
  it('never shows or recycles another workspace’s leads', async () => {
    await setPolicy(fixture.a.tenantId, 90);
    await setPolicy(fixture.b.tenantId, 90);
    const stageB = await lostStage(fixture.b.tenantId);
    const leadB = fixture.b.leadIds[1]!;
    await markLost(fixture.b.tenantId, leadB, stageB, 400);

    const queueA = await findRecyclable(fixture.a.tenantId);
    expect(queueA.some((row) => row.id === leadB)).toBe(false);

    // And asking for it by id from the wrong workspace finds nothing.
    const result = await recycleLeads({ tenantId: fixture.a.tenantId }, [leadB]);
    expect(result.recycled).toBe(0);
    expect(result.skipped[0]?.reason).toMatch(/not found/i);

    const untouched = await prisma.lead.findFirstOrThrow({
      where: { tenantId: fixture.b.tenantId, id: leadB },
      select: { stageId: true, recycleCount: true },
    });
    expect(untouched.stageId).toBe(stageB);
    expect(untouched.recycleCount).toBe(0);
  });
});
