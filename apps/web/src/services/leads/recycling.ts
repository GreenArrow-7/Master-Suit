import { prisma, withTx, withPlatformTx } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueue } from '@/lib/queue';
import { blockedReason, policyFrom, type RecyclePolicy } from '@/lib/leads/recycling';
import type { Ctx } from '@/lib/security/rbac';

/**
 * Lost leads, back on the floor.
 *
 * The rules are in lib/leads/recycling.ts. This is the half that touches the
 * database: finding who is eligible, and handing them over.
 *
 * "When did it go cold" comes from LeadStageHistory rather than a column on
 * Lead. Every stage change already writes a history row, the table is already
 * indexed on (tenantId, toStageId, createdAt), and a new column would have been
 * null for every lead lost before the migration ran — so the feature would have
 * arrived with an empty queue and no way to fill it.
 */

/** One page of candidates. Recycling is a review queue, not a batch job. */
const PAGE = 200;

export interface Candidate {
  id: string;
  reference: string;
  fullName: string;
  stageName: string;
  ownerName: string | null;
  lostAt: Date | null;
  recycleCount: number;
  /** Null means it can go now. */
  blocked: string | null;
}

export async function recyclePolicy(tenantId: string): Promise<RecyclePolicy> {
  const setting = await prisma.organizationSetting.findUnique({
    where: { tenantId },
    select: { leadRecycleAfterDays: true, leadRecycleMaxTimes: true, leadRecycleStageId: true },
  });
  return policyFrom(setting);
}

/**
 * Everything sitting in a lost stage, with the verdict on each.
 *
 * Blocked leads are returned too, not filtered out. An administrator looking at
 * this screen wants to know why the queue is short, and "they asked not to be
 * called" is the most important row on it.
 *
 * Only TERMINAL_NEGATIVE stages. TERMINAL_JUNK is a wrong number or a bot
 * filling in a form, and recycling that moves noise around the floor.
 */
export async function findRecyclable(tenantId: string, now = new Date()): Promise<Candidate[]> {
  const policy = await recyclePolicy(tenantId);

  return withTx(tenantId, async (tx) => {
    const lostStages = await tx.leadStage.findMany({
      where: { tenantId, category: 'TERMINAL_NEGATIVE', deletedAt: null },
      select: { id: true, name: true },
    });
    if (lostStages.length === 0) return [];
    const lostIds = lostStages.map((stage) => stage.id);

    const leads = await tx.lead.findMany({
      where: { tenantId, deletedAt: null, stageId: { in: lostIds } },
      // Least recently touched first: the ones most likely to be past their
      // cooling-off period, so a capped page is the useful end of the list.
      orderBy: { updatedAt: 'asc' },
      take: PAGE,
      select: {
        id: true,
        reference: true,
        fullName: true,
        stageId: true,
        ownerId: true,
        recycleCount: true,
        doNotCall: true,
        consentStatus: true,
        isMerged: true,
        duplicateOfId: true,
      },
    });
    if (leads.length === 0) return [];

    const leadIds = leads.map((lead) => lead.id);

    /**
     * The most recent arrival in a lost stage, per lead.
     *
     * Newest first, and the first row seen for a lead wins — a lead that was
     * lost in March, reopened, and lost again in August cools off from August.
     */
    const history = await tx.leadStageHistory.findMany({
      where: { tenantId, leadId: { in: leadIds }, toStageId: { in: lostIds } },
      orderBy: { createdAt: 'desc' },
      select: { leadId: true, createdAt: true },
    });
    const lostAt = new Map<string, Date>();
    for (const row of history) if (!lostAt.has(row.leadId)) lostAt.set(row.leadId, row.createdAt);

    const ownerIds = [...new Set(leads.map((lead) => lead.ownerId).filter((id): id is string => !!id))];
    const owners = ownerIds.length
      ? await tx.user.findMany({ where: { tenantId, id: { in: ownerIds } }, select: { id: true, fullName: true } })
      : [];
    const ownerName = new Map(owners.map((owner) => [owner.id, owner.fullName]));
    const stageName = new Map(lostStages.map((stage) => [stage.id, stage.name]));

    return leads.map((lead) => ({
      id: lead.id,
      reference: lead.reference,
      fullName: lead.fullName,
      stageName: stageName.get(lead.stageId) ?? 'Lost',
      ownerName: lead.ownerId ? (ownerName.get(lead.ownerId) ?? null) : null,
      lostAt: lostAt.get(lead.id) ?? null,
      recycleCount: lead.recycleCount,
      blocked: blockedReason({ ...lead, lostAt: lostAt.get(lead.id) ?? null }, policy, now),
    }));
  });
}

/**
 * Where a recycled lead lands.
 *
 * The configured stage if it still exists and is still somewhere a lead can
 * work from, otherwise the pipeline's default. A stage that was deleted or
 * later marked terminal would otherwise recycle leads straight back into the
 * queue they came from, forever.
 */
async function returnStage(tenantId: string, policy: RecyclePolicy) {
  const chosen = policy.returnStageId
    ? await prisma.leadStage.findFirst({
        where: { tenantId, id: policy.returnStageId, category: 'OPEN', deletedAt: null },
        select: { id: true, name: true, slaMinutes: true },
      })
    : null;
  if (chosen) return chosen;

  return prisma.leadStage.findFirst({
    where: { tenantId, category: 'OPEN', deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
    select: { id: true, name: true, slaMinutes: true },
  });
}

export interface RecycleResult {
  recycled: number;
  skipped: { id: string; reason: string }[];
}

/**
 * Hand these leads back to the floor.
 *
 * Every lead is re-checked inside the transaction rather than trusted from the
 * list the caller was looking at. That list was rendered at some point in the
 * past, and between then and now somebody may have ticked "do not call" — which
 * is exactly the change that must win.
 *
 * The owner is cleared rather than reassigned here, and the existing
 * distribution queue picks it up. That is the same path a new lead takes, so a
 * workspace's round-robin, its weighting and its pointer all keep working
 * without recycling owning a second copy of them.
 */
export async function recycleLeads(
  ctx: Pick<Ctx, 'tenantId'> & { actor?: { id: string } },
  leadIds: string[],
  now = new Date(),
): Promise<RecycleResult> {
  if (leadIds.length === 0) return { recycled: 0, skipped: [] };

  const tenantId = ctx.tenantId;
  const policy = await recyclePolicy(tenantId);
  if (policy.afterDays <= 0) {
    return { recycled: 0, skipped: leadIds.map((id) => ({ id, reason: 'Recycling is switched off.' })) };
  }

  const stage = await returnStage(tenantId, policy);
  if (!stage) {
    return { recycled: 0, skipped: leadIds.map((id) => ({ id, reason: 'This pipeline has no open stage.' })) };
  }

  const lostStageIds = (
    await prisma.leadStage.findMany({
      where: { tenantId, category: 'TERMINAL_NEGATIVE', deletedAt: null },
      select: { id: true },
    })
  ).map((row) => row.id);

  const skipped: RecycleResult['skipped'] = [];
  const moved: string[] = [];

  for (const leadId of leadIds) {
    const outcome = await withTx(tenantId, async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { tenantId, id: leadId, deletedAt: null },
        select: {
          id: true,
          stageId: true,
          ownerId: true,
          recycleCount: true,
          doNotCall: true,
          consentStatus: true,
          isMerged: true,
          duplicateOfId: true,
        },
      });
      if (!lead) return 'Lead not found.';
      if (!lostStageIds.includes(lead.stageId)) return 'No longer in a lost stage.';

      const latest = await tx.leadStageHistory.findFirst({
        where: { tenantId, leadId, toStageId: { in: lostStageIds } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      const reason = blockedReason({ ...lead, lostAt: latest?.createdAt ?? null }, policy, now);
      if (reason) return reason;

      await tx.lead.update({
        where: { tenantId, id: leadId },
        data: {
          stageId: stage.id,
          // The old sub-status explained why nothing was moving in a
          // conversation that has now ended. Carrying it forward would label a
          // fresh attempt with the last one's excuse.
          subStatusId: null,
          ownerId: null,
          assignedAt: null,
          recycleCount: { increment: 1 },
          recycledAt: now,
          slaState: 'ON_TRACK',
          slaDueAt: stage.slaMinutes ? new Date(now.getTime() + stage.slaMinutes * 60_000) : null,
          updatedById: ctx.actor?.id ?? null,
        },
      });

      await tx.leadStageHistory.create({
        data: {
          tenantId,
          leadId,
          fromStageId: lead.stageId,
          toStageId: stage.id,
          changedById: ctx.actor?.id ?? null,
          // What the sweep signs its work with, so a history row nobody
          // recognises is not read as an agent having moved it by hand.
          changedBySystem: ctx.actor?.id ? null : 'RECYCLE_SWEEP',
          reason: 'RECYCLED',
        },
      });

      if (lead.ownerId) {
        await tx.leadAssignmentHistory.create({
          data: {
            tenantId,
            leadId,
            fromOwnerId: lead.ownerId,
            toOwnerId: null,
            assignedById: ctx.actor?.id ?? null,
            reason: 'RECYCLED',
          },
        });
      }

      return null;
    });

    if (outcome) skipped.push({ id: leadId, reason: outcome });
    else moved.push(leadId);
  }

  // Outside the transactions: a queued job that runs before its own commit
  // finds a lead that is still owned and does nothing.
  for (const leadId of moved) {
    await enqueue('distribution', 'assign-lead', { tenantId, leadId });
    if (stage.slaMinutes) {
      await enqueue('sla', 'lead-first-contact', { tenantId, leadId }, { delayMs: stage.slaMinutes * 60_000 });
    }
    await enqueue('automation', 'trigger', { tenantId, event: 'record.updated', object: 'LEAD', recordId: leadId });
  }

  return { recycled: moved.length, skipped };
}

/**
 * The nightly pass, across every workspace that has switched recycling on.
 *
 * Per tenant rather than one cross-tenant query, so the eligibility rules have
 * exactly one implementation. The alternative — a second copy of them in SQL —
 * is how a consent check ends up enforced in one place and not the other.
 */
export async function runRecycleSweep(now = new Date()): Promise<{ tenants: number; recycled: number }> {
  const enabled = await withPlatformTx((tx) =>
    tx.organizationSetting.findMany({
      where: { leadRecycleAfterDays: { gt: 0 } },
      select: { tenantId: true },
    }),
  );

  let recycled = 0;
  for (const { tenantId } of enabled) {
    try {
      const candidates = await findRecyclable(tenantId, now);
      const ready = candidates.filter((candidate) => candidate.blocked === null).map((candidate) => candidate.id);
      if (ready.length === 0) continue;
      const result = await recycleLeads({ tenantId }, ready, now);
      recycled += result.recycled;
    } catch (err) {
      // One workspace's broken pipeline must not stop the rest of the sweep.
      logger.error({ err, tenantId }, 'lead recycle sweep failed for tenant');
    }
  }

  return { tenants: enabled.length, recycled };
}
