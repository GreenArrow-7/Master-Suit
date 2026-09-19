import { prisma } from '@/lib/db';

/**
 * `Lead.lastActivityAt` is what "has this lead been worked?" reads — the untouched
 * count on Productivity, the work-gated check-out, the grid column. Nothing wrote
 * it until 19 Sep 2026, so every lead read as untouched forever. Every place a
 * person works a lead — logging an activity, placing or finishing a call — calls
 * this; a missing lead id is a no-op so callers need no branching.
 */
export async function touchLead(tenantId: string, leadId: string | null | undefined, at: Date = new Date()) {
  if (!leadId) return;
  await prisma.lead.updateMany({ where: { tenantId, id: leadId, deletedAt: null }, data: { lastActivityAt: at } });
}
