import type { TxClient } from '@/lib/db';

/**
 * What a workspace needs before it can work a lead: lead stages, activity types
 * and task types.
 *
 * `Lead.stageId`, `Activity.typeId` and `Task.typeId` are required, and every
 * composer picks from these per-tenant lists. With a list empty a lead cannot be
 * created ("Lead stage not found") and pressing "Log" does nothing at all. Any
 * module that works leads needs them — Sales, Real Estate and Lead Eagle — but
 * they were provisioned for Sales alone, so a Real-Estate-only or
 * Lead-Eagle-only workspace created through the wizard could not take its first
 * lead.
 *
 * Deliberately a small starting set rather than the seed's twenty: the ones every
 * team uses on day one; a workspace adds its own. `scoreDelta` mirrors the seed
 * so lead scoring behaves the same in a provisioned workspace as in the demo.
 *
 * Each list is filled only when the workspace has none of it: this is for a
 * workspace that has nothing yet — at creation, or when a module that works
 * leads is switched on later — never a reset of one that has made its own.
 */
export async function provisionLeadWork(tx: TxClient, tenantId: string): Promise<void> {
  if ((await tx.leadStage.count({ where: { tenantId } })) === 0) {
    await tx.leadStage.createMany({
      data: [
        { tenantId, key: 'new', name: 'New', position: 1, isDefault: true },
        { tenantId, key: 'qualified', name: 'Qualified', position: 2 },
        { tenantId, key: 'won', name: 'Won', position: 3, category: 'CONVERSION' },
        { tenantId, key: 'lost', name: 'Lost', position: 4, category: 'TERMINAL_NEGATIVE' },
      ],
    });
  }
  if ((await tx.activityType.count({ where: { tenantId } })) === 0) {
    await tx.activityType.createMany({
      data: [
        { tenantId, key: 'call_out', name: 'Outbound call', scoreDelta: 3, position: 0 },
        { tenantId, key: 'call_in', name: 'Incoming call', scoreDelta: 8, position: 1 },
        { tenantId, key: 'email_sent', name: 'Email sent', scoreDelta: 1, position: 2 },
        { tenantId, key: 'meeting', name: 'Meeting', scoreDelta: 12, position: 3 },
        { tenantId, key: 'follow_up', name: 'Follow-up completed', scoreDelta: 3, position: 4 },
        { tenantId, key: 'note', name: 'Lead note', scoreDelta: 0, position: 5 },
      ],
    });
  }
  if ((await tx.taskType.count({ where: { tenantId } })) === 0) {
    await tx.taskType.createMany({
      data: [
        { tenantId, key: 'call', name: 'Call', category: 'TODO' },
        { tenantId, key: 'meeting', name: 'Meeting', category: 'APPOINTMENT' },
        { tenantId, key: 'follow_up', name: 'Follow-up', category: 'TODO' },
        { tenantId, key: 'internal', name: 'Internal task', category: 'TODO' },
      ],
    });
  }
}
