import { prisma, withTx } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * DistributionMethod supports ROUND_ROBIN, WEIGHTED, SKILL_BASED, LEAST_LOADED,
 * TERRITORY, MANUAL, EXTERNAL (see schema enum). Only ROUND_ROBIN is implemented —
 * it is the one every tenant needs on day one, and it's what the seed plan tests.
 * ponytail: add the other methods as a `switch (rule.method)` here when a tenant's
 * distribution config actually needs one.
 */
export async function assignLead(tenantId: string, leadId: string) {
  const rule = await prisma.distributionRule.findFirst({
    where: { tenantId, objectType: 'LEAD', isActive: true, method: 'ROUND_ROBIN', deletedAt: null },
    orderBy: { position: 'asc' },
  });
  if (!rule) return;

  const pool = (rule.candidatePool as { userIds?: string[] })?.userIds ?? [];
  if (pool.length === 0) return;

  const lastIndex = rule.lastAssignedUserId ? pool.indexOf(rule.lastAssignedUserId) : -1;
  const nextUserId = pool[(lastIndex + 1) % pool.length]!;

  await withTx(tenantId, async (tx) => {
    const lead = await tx.lead.findFirst({ where: { tenantId, id: leadId } });
    if (!lead || lead.ownerId) return; // already assigned since this job was queued

    await tx.lead.update({ where: { tenantId, id: leadId }, data: { ownerId: nextUserId, assignedAt: new Date() } });
    await tx.leadAssignmentHistory.create({
      data: { tenantId, leadId, toOwnerId: nextUserId, reason: 'DISTRIBUTION_RULE' },
    });
    await tx.distributionRule.update({ where: { tenantId, id: rule.id }, data: { lastAssignedUserId: nextUserId } });
  });

  logger.info({ tenantId, leadId, assignedTo: nextUserId, rule: rule.name }, 'lead distributed');
}
