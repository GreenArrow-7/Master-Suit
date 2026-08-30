import { withTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { auditDiff } from '@/lib/security/audit';
import { assertRecordVisible } from '@/lib/security/visibility';
import { can, type Ctx } from '@/lib/security/rbac';
import { enqueue } from '@/lib/queue';
import { emit } from '../shared/events';
import { notifyCrm } from '../crm/notify';

export interface UpdateLeadInput {
  fullName?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  country?: string;
  city?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  tags?: string[];
  stageId?: string;
  ownerId?: string | null;
  [k: string]: unknown;
}

/**
 * Same visibility-then-mutate shape as every write in the platform: load the row
 * inside the transaction, re-check visibility there (a list-only check is an IDOR),
 * diff for the audit log, then hand off owner/stage side effects to the queues.
 */
export async function updateLead(ctx: Ctx, id: string, input: UpdateLeadInput) {
  if (input.ownerId !== undefined && !can(ctx, 'leads', 'ASSIGN') && !can(ctx, 'leads', 'REASSIGN')) {
    delete input.ownerId;
  }

  /**
   * What actually changed, carried out of the transaction so the notifications
   * can be written after it commits.
   *
   * Only these two are announced. "Lead updates" in the abstract includes fixing
   * a typo in a job title, and a bell that fires on every field edit is one
   * people learn to ignore — which would cost the stage and owner changes their
   * audience too. The audit log already records every field; this is for the two
   * events that change who is responsible and what happens next.
   */
  let stageChangedTo: string | null = null;
  let previousOwnerId: string | null = null;
  let ownerChanged = false;

  const updated = await withTx(ctx.tenantId, async (tx) => {
    const before = await tx.lead.findFirst({ where: { tenantId: ctx.tenantId, id } });
    if (!before) throw NotFound('Lead');
    await assertRecordVisible(ctx, 'leads', before, tx, 'EDIT');

    if (input.stageId && input.stageId !== before.stageId) {
      const stage = await tx.leadStage.findFirst({ where: { tenantId: ctx.tenantId, id: input.stageId } });
      if (!stage) throw NotFound('Lead stage');
      stageChangedTo = stage.name;
      await tx.leadStageHistory.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: id,
          fromStageId: before.stageId,
          toStageId: stage.id,
          changedById: ctx.actor.id,
        },
      });
    }

    if (input.ownerId !== undefined && input.ownerId !== before.ownerId) {
      ownerChanged = true;
      previousOwnerId = before.ownerId;
      await tx.leadAssignmentHistory.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: id,
          fromOwnerId: before.ownerId,
          toOwnerId: input.ownerId,
          assignedById: ctx.actor.id,
          reason: 'REASSIGNED',
        },
      });
    }

    const after = await tx.lead.update({
      where: { tenantId: ctx.tenantId, id },
      data: {
        ...(input.fullName !== undefined && { fullName: input.fullName }),
        ...(input.email !== undefined && { email: input.email.toLowerCase() }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.company !== undefined && { company: input.company }),
        ...(input.jobTitle !== undefined && { jobTitle: input.jobTitle }),
        ...(input.country !== undefined && { country: input.country }),
        ...(input.city !== undefined && { city: input.city }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.tags !== undefined && { tags: input.tags }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.stageId !== undefined && { stageId: input.stageId }),
        ...(input.ownerId !== undefined && { ownerId: input.ownerId, assignedAt: input.ownerId ? new Date() : null }),
        updatedById: ctx.actor.id,
      },
    });

    await auditDiff(ctx, 'lead', id, before, after, tx);
    return after;
  });

  await enqueue('automation', 'trigger', {
    tenantId: ctx.tenantId,
    event: 'record.updated',
    object: 'LEAD',
    recordId: id,
  });
  /**
   * Reassignment tells both ends. The new owner needs to know they have it; the
   * previous owner otherwise watches a record leave their list with no
   * explanation, which is the reassignment complaint every CRM eventually gets.
   */
  if (ownerChanged) {
    await notifyCrm(ctx, {
      event: 'lead.assigned',
      ownerId: updated.ownerId,
      alsoNotify: [previousOwnerId],
      title: `Lead assigned: ${updated.fullName}`,
      body: updated.reference,
      objectType: 'lead',
      recordId: id,
      priority: 'HIGH',
    });
  }

  if (stageChangedTo) {
    await notifyCrm(ctx, {
      event: 'lead.stage_changed',
      ownerId: updated.ownerId,
      title: `${updated.fullName} moved to ${stageChangedTo}`,
      body: updated.reference,
      objectType: 'lead',
      recordId: id,
    });
  }

  emit(ctx, 'lead.updated', { leadId: id });
  return updated;
}

/** Soft delete: sets deletedAt rather than removing the row — every list query filters it out. */
export async function deleteLead(ctx: Ctx, id: string) {
  await withTx(ctx.tenantId, async (tx) => {
    const before = await tx.lead.findFirst({ where: { tenantId: ctx.tenantId, id } });
    if (!before) throw NotFound('Lead');
    await assertRecordVisible(ctx, 'leads', before, tx, 'DELETE');
    await tx.lead.update({
      where: { tenantId: ctx.tenantId, id },
      data: { deletedAt: new Date(), updatedById: ctx.actor.id },
    });
    await auditDiff(ctx, 'lead', id, before, { ...before, deletedAt: new Date() }, tx);
  });
}
