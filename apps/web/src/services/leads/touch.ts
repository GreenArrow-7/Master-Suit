import { prisma } from '@/lib/db';

/**
 * `Lead.lastActivityAt` is what "has this lead been worked?" reads — the untouched
 * count on Productivity, the work-gated check-out, the grid column. Nothing wrote
 * it until 19 Sep 2026, so every lead read as untouched forever. Every place a
 * person works a lead — logging an activity, placing or finishing a call — calls
 * this; a missing lead id is a no-op so callers need no branching.
 *
 * The first touch is also when the lead was first contacted (`firstContactedAt`):
 * the SLA's first-contact check, the board's Untouched tile and its "worked"
 * days read it, and nothing wrote it either. The earliest touch wins, so a call
 * logged late for an earlier hour moves it back and a later one leaves it.
 */
export async function touchLead(tenantId: string, leadId: string | null | undefined, at: Date = new Date()) {
  if (!leadId) return;
  await prisma.lead.updateMany({ where: { tenantId, id: leadId, deletedAt: null }, data: { lastActivityAt: at } });
  await prisma.lead.updateMany({
    where: {
      tenantId,
      id: leadId,
      deletedAt: null,
      OR: [{ firstContactedAt: null }, { firstContactedAt: { gt: at } }],
    },
    data: { firstContactedAt: at },
  });
}
