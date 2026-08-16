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

/**
 * The next user in the tenant's round-robin, advancing the pointer.
 *
 * Shared with social enquiries so one rotation covers all inbound work rather
 * than two competing ones — a rep who just took a Facebook comment should be
 * behind their colleagues for the next website lead too.
 *
 * ponytail: assignLead above keeps its own copy of the rotation inside its
 * transaction because it must NOT advance the pointer when the lead turns out to
 * be already assigned. Merging them would either move the pointer on a no-op or
 * force social enquiries into a lead-shaped transaction. Two short readers beat
 * one wrong one; revisit if a third caller appears.
 */
export async function nextDistributionOwner(tenantId: string): Promise<{ userId: string | null; note: string | null }> {
  const rule = await prisma.distributionRule.findFirst({
    where: { tenantId, objectType: 'LEAD', isActive: true, method: 'ROUND_ROBIN', deletedAt: null },
    orderBy: { position: 'asc' },
  });
  if (!rule) return { userId: null, note: 'No matching distribution rule.' };

  const pool = (rule.candidatePool as { userIds?: string[] })?.userIds ?? [];
  if (pool.length === 0) return { userId: null, note: `No members in ${rule.name}.` };

  const lastIndex = rule.lastAssignedUserId ? pool.indexOf(rule.lastAssignedUserId) : -1;

  /**
   * Walk the pool until someone can actually work it, rather than giving up on
   * the first inactive account. A rotation that stops at the first suspended
   * user leaves every later enquiry unassigned until somebody edits the rule.
   */
  for (let step = 1; step <= pool.length; step += 1) {
    const candidate = pool[(lastIndex + step) % pool.length]!;
    const usable = await prisma.user.findFirst({
      where: { tenantId, id: candidate, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!usable) continue;
    await prisma.distributionRule.update({
      where: { tenantId, id: rule.id },
      data: { lastAssignedUserId: candidate },
    });
    return { userId: candidate, note: null };
  }

  return { userId: null, note: `No eligible members in ${rule.name}.` };
}
