import { prisma, withTx } from '@/lib/db';
import { enqueue } from '@/lib/queue';
import { logger } from '@/lib/logger';
import { audit } from '@/lib/security/audit';

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

  // The breach and its audit row commit together, and only the write that moved
  // the state records it: a retry after a failed insert still audits, a
  // duplicate job does not audit twice.
  await withTx(tenantId, async (tx) => {
    const { count } = await tx.lead.updateMany({
      where: { tenantId, id: leadId, slaState: { not: 'BREACHED' } },
      data: { slaState: 'BREACHED' },
    });
    if (!count) return;
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

  await enqueue('automation', 'trigger', { tenantId, event: 'sla.warning', object: 'LEAD', recordId: leadId });
}
