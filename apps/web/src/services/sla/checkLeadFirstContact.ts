import { prisma, withPlatformTx, withTx } from '@/lib/db';
import { enqueue } from '@/lib/queue';
import { logger } from '@/lib/logger';
import { audit } from '@/lib/security/audit';
import { notifyCrm } from '@/services/crm/notify';
import { activeRule, assignLead } from '@/services/distribution/assignLead';

/**
 * Runs once, at the lead's slaDueAt (createLead delays the job that far out — see
 * services/leads/createLead.ts). If nobody has logged first contact by then, the
 * lead is breached and an automation event fires so a notify_manager action (or
 * whatever the tenant configured) can react. A lead handed out later is the
 * recurring sweep's (`sweepFirstContact` below).
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
      // Escalated for whoever holds it now; the sweep takes the next hand-over.
      data: { slaState: 'BREACHED', slaEscalatedAt: new Date() },
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
 * The recurring half (audit M17-08). The delayed check above runs once, at the
 * deadline set when the lead arrived; a lead handed out after it (from the
 * triage queue, by Allocate, by bulk assign) had nothing left to catch it. Every
 * five minutes this escalates each lead its owner has left without first
 * contact for longer than its stage's "Respond within" minutes, counted from
 * when they got it: once per hand-over, claimed by `slaEscalatedAt`, so two
 * overlapping runs escalate it once and the delayed check is not repeated.
 *
 * ponytail: looks back one day past each deadline, so a worker that was down
 * for a week does not escalate a week of leads on restart; 200 a run.
 */
export async function sweepFirstContact(now = new Date(), tenantId?: string): Promise<{ escalated: number }> {
  const floor = new Date(now.getTime() - 86_400_000);
  // Across workspaces, so through the platform flag RLS names, as the reminder sweep does.
  const due = await withPlatformTx(
    (tx) => tx.$queryRaw<{ tenantId: string; id: string }[]>`
      SELECT l."tenantId", l.id
        FROM "Lead" l
        JOIN "LeadStage" s ON s.id = l."stageId" AND s."tenantId" = l."tenantId"
       WHERE l."deletedAt" IS NULL AND l."firstContactedAt" IS NULL
         AND l."ownerId" IS NOT NULL AND l."assignedAt" IS NOT NULL
         AND (l.status IS NULL OR l.status NOT IN ('INVALID', 'DUPLICATE', 'ARCHIVED'))
         AND s.category = 'OPEN' AND s."slaMinutes" IS NOT NULL
         AND l."assignedAt" + make_interval(mins => s."slaMinutes") <= ${now}
         AND l."assignedAt" + make_interval(mins => s."slaMinutes") > ${floor}
         AND (l."slaEscalatedAt" IS NULL OR l."slaEscalatedAt" < l."assignedAt")
         AND (${tenantId ?? null}::text IS NULL OR l."tenantId" = ${tenantId ?? null})
       ORDER BY l."assignedAt"
       LIMIT 200`,
  );
  let escalated = 0;
  for (const row of due) {
    // One lead's failure is not the rest's.
    try {
      const lead = await prisma.lead.findFirst({
        where: { tenantId: row.tenantId, id: row.id },
        select: { id: true, fullName: true, ownerId: true, assignedAt: true, slaState: true },
      });
      if (!lead?.ownerId || !lead.assignedAt) continue;
      const handedAt = lead.assignedAt;
      const claimed = await withTx(row.tenantId, async (tx) => {
        const { count } = await tx.lead.updateMany({
          where: {
            tenantId: row.tenantId,
            id: lead.id,
            ownerId: lead.ownerId,
            assignedAt: handedAt,
            firstContactedAt: null,
            OR: [{ slaEscalatedAt: null }, { slaEscalatedAt: { lt: handedAt } }],
          },
          data: { slaState: 'BREACHED', slaEscalatedAt: now },
        });
        if (count && lead.slaState !== 'BREACHED') {
          await audit(
            { tenantId: row.tenantId, source: 'sla' },
            {
              event: 'RECORD_UPDATED',
              objectType: 'lead',
              recordId: lead.id,
              fieldKey: 'slaState',
              previousValue: lead.slaState,
              newValue: 'BREACHED',
            },
            tx,
          );
        }
        return count > 0;
      });
      if (!claimed) continue;
      await escalate(row.tenantId, lead);
      escalated += 1;
    } catch (err) {
      logger.warn({ err, tenantId: row.tenantId, leadId: row.id }, 'first-contact escalation skipped');
    }
  }
  if (escalated) logger.info({ escalated }, 'untouched leads escalated');
  return { escalated };
}

/**
 * What a breach does without any automation configured (audit M7-08, M7-09):
 * the owner's reporting manager is told, and when the active assignment rule
 * asks for re-assignment the lead goes back through the rotation.
 *
 * ponytail: `reassignAfterMins` is read as "re-assign on breach" — at the stage's
 * minutes, not its own. A separate timer per rule is a second sweep condition.
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
  const released = await withTx(tenantId, async (tx) => {
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
    return count > 0;
  });
  if (!released) return;
  const outcome = await assignLead(tenantId, lead.id);
  // The agent it was taken from hears why (audit M17-07), unless the rotation gave
  // it straight back; assignLead tells whoever has it now.
  if (outcome.outcome === 'assigned' && outcome.userId === lead.ownerId) return;
  await notifyCrm(system, {
    event: 'lead.assigned',
    ownerId: lead.ownerId,
    title: `Lead taken back: ${lead.fullName}`,
    body:
      outcome.outcome === 'assigned'
        ? 'First contact was overdue, so it went to the next person in turn.'
        : 'First contact was overdue, so it is waiting to be handed out again.',
    objectType: 'lead',
    recordId: lead.id,
  });
}
