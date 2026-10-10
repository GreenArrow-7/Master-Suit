import { prisma } from '@/lib/db';
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

  await prisma.lead.updateMany({ where: { tenantId, id: leadId }, data: { slaState: 'BREACHED' } });
  logger.warn({ tenantId, leadId }, 'lead SLA breached');
  if (lead.slaState !== 'BREACHED') {
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
    );
  }

  await enqueue('automation', 'trigger', { tenantId, event: 'sla.warning', object: 'LEAD', recordId: leadId });
}
