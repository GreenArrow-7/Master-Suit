import { prisma, withTx } from '@/lib/db';
import { enqueue } from '@/lib/queue';
import { logger } from '@/lib/logger';
import { audit } from '@/lib/security/audit';
import { notifyCrm } from '@/services/crm/notify';
import { activeRule, assignLead } from '@/services/distribution/assignLead';

/**
 * Runs once, at the lead's slaDueAt (createLead delays the job that far out — see
 * services/leads/createLead.ts). If nobody has logged first contact by then, the
 * lead is breached and an automation event fires so a notify_manager action (or
 * whatever the tenant configured) can react.
 *
 * ponytail: this is a single delayed check, not the recurring sweep
 * docs/00-ARCHITECTURE.md's maintenance queue implies for catching missed/edited
 * due dates. Add a periodic sweep job if delayed jobs prove to drift or get lost.
 */
export async function checkLeadFirstContact(tenantId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { tenantId, id: leadId } });
  if (!lead || lead.firstContactedAt) return;

  let breachedNow = true;
  // The breach and its audit row commit together, and only the write that moved
  // the state records it: a retry after a failed insert still audits, a
  // duplicate job does not audit twice.
  await withTx(tenantId, async (tx) => {
    const { count } = await tx.lead.updateMany({
      where: { tenantId, id: leadId, slaState: { not: 'BREACHED' } },
      data: { slaState: 'BREACHED' },
    });
    if (!count) {
      breachedNow = false;
      return;
    }
    await audit(
      { tenantId, source: 'sla' },
      {
        event: 'RECORD_UPDATED',
        objectType: 'lead',
        recordId: leadId,
        fieldKey: 'slaState',
        previousValue: lead.slaState,
        newValue: 'BREACHED',
      },
      tx,
    );
  });
  logger.warn({ tenantId, leadId }, 'lead SLA breached');
  if (breachedNow) await escalate(tenantId, lead);

  await enqueue('automation', 'trigger', { tenantId, event: 'sla.warning', object: 'LEAD', recordId: leadId });
}

/**
 * What a breach does without any automation configured (audit M7-08, M7-09):
 * the owner's reporting manager is told, and when the active assignment rule
 * asks for re-assignment the lead goes back through the rotation.
 *
 * ponytail: `reassignAfterMins` is read as "re-assign on breach" — the check runs
 * once, at slaDueAt. A separate timer per rule needs a second delayed job.
 */
async function escalate(tenantId: string, lead: { id: string; fullName: string; ownerId: string | null }) {
  const system = { tenantId, actor: { id: 'system' } };
  if (lead.ownerId) {
    const owner = await prisma.user.findFirst({
      where: { tenantId, id: lead.ownerId },
      select: { fullName: true, managerId: true },
    });
    if (owner?.managerId) {
      await notifyCrm(system, {
        event: 'lead.sla_breached',
        ownerId: owner.managerId,
        title: `${lead.fullName} has not been contacted`,
        body: `First contact by ${owner.fullName} is overdue.`,
        objectType: 'lead',
        recordId: lead.id,
        priority: 'HIGH',
      });
    }
  }

  const rule = await activeRule(tenantId);
  if (!rule?.reassignAfterMins || !lead.ownerId) return;
  await withTx(tenantId, async (tx) => {
    const { count } = await tx.lead.updateMany({
      where: { tenantId, id: lead.id, ownerId: lead.ownerId, firstContactedAt: null },
      data: { ownerId: null },
    });
    if (count) {
      await audit(
        { tenantId, source: 'sla' },
        {
          event: 'OWNER_CHANGED',
          objectType: 'lead',
          recordId: lead.id,
          fieldKey: 'ownerId',
          previousValue: lead.ownerId,
          newValue: null,
        },
        tx,
      );
    }
  });
  await assignLead(tenantId, lead.id);
}
