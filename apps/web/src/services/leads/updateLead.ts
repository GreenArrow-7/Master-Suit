import { withTx } from '@/lib/db';
import { AppError, NotFound } from '@/lib/errors';
import { auditDiff } from '@/lib/security/audit';
import { assertRecordVisible } from '@/lib/security/visibility';
import { can, type Ctx } from '@/lib/security/rbac';
import { enqueue } from '@/lib/queue';
import { notifyCrm } from '../crm/notify';
import { recordTargetProgress } from '../targets/progress';
import { normalizePhone } from './normalizePhone';

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
  /** Why it moves: required when the target stage says so. */
  stageReason?: string;
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
  /** Set only when the stage changes: the new stage's reason, or null. */
  let enteredReason: string | null | undefined;
  let stageChangedKey: string | null = null;
  let stageChangedCategory: string | null = null;
  let previousOwnerId: string | null = null;
  let ownerChanged = false;

  const updated = await withTx(ctx.tenantId, async (tx) => {
    const before = await tx.lead.findFirst({ where: { tenantId: ctx.tenantId, id } });
    if (!before) throw NotFound('Lead');
    await assertRecordVisible(ctx, 'leads', before, tx, 'EDIT');

    if (input.stageId && input.stageId !== before.stageId) {
      const stage = await tx.leadStage.findFirst({ where: { tenantId: ctx.tenantId, id: input.stageId } });
      if (!stage) throw NotFound('Lead stage');
      // A stage that claims something happened carries the evidence: its reason,
      // and the fields it names. Checked here, so every screen obeys it.
      const reason = input.stageReason?.trim() || null;
      if (stage.requiresReason && !reason) refuse('stageReason', `Moving a lead to ${stage.name} needs a reason.`);
      if (reason && stage.reasons.length && !stage.reasons.includes(reason)) {
        refuse('stageReason', `Choose one of ${stage.name}'s reasons: ${stage.reasons.join(', ')}.`);
      }
      const after = { ...before, ...input } as Record<string, unknown>;
      const missing = stage.requiredFields.filter((field) => !String(after[field] ?? '').trim());
      if (missing.length) refuse(missing[0]!, `${stage.name} needs: ${missing.join(', ')}.`);
      enteredReason = reason;
      stageChangedTo = stage.name;
      stageChangedKey = stage.key;
      stageChangedCategory = stage.category;
      await tx.leadStageHistory.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: id,
          fromStageId: before.stageId,
          toStageId: stage.id,
          changedById: ctx.actor.id,
          reason,
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
        // Both columns, as updateContact does: duplicate matching reads the
        // normalised one, and leaving it behind matched the old number forever.
        ...(input.phone !== undefined && { phone: input.phone, phoneNormalized: normalizePhone(input.phone) }),
        ...(input.company !== undefined && { company: input.company }),
        ...(input.jobTitle !== undefined && { jobTitle: input.jobTitle }),
        ...(input.country !== undefined && { country: input.country }),
        ...(input.city !== undefined && { city: input.city }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.tags !== undefined && { tags: input.tags }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.stageId !== undefined && { stageId: input.stageId }),
        ...(enteredReason !== undefined && { stageReason: enteredReason }),
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

  /**
   * Target metrics ride the stage transition. LEADS_CONVERTED keys on the
   * stage's category — CONVERSION is the semantic "won" marker, tenant-safe.
   * LEADS_QUALIFIED has no category of its own, so it keys on the stage key
   * the seed and reference pipeline use; a workspace that renames the
   * qualified stage's key simply does not count that metric, which is the
   * honest behaviour until the schema grows a QUALIFIED category.
   */
  if (stageChangedCategory === 'CONVERSION') {
    await recordTargetProgress(ctx, updated.ownerId, 'LEADS_CONVERTED');
  }
  if (stageChangedKey === 'qualified') {
    await recordTargetProgress(ctx, updated.ownerId, 'LEADS_QUALIFIED');
  }
  if (ownerChanged && updated.ownerId) {
    await recordTargetProgress(ctx, updated.ownerId, 'LEADS_ASSIGNED');
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

/** A 422 whose detail is the sentence the screen shows. */
function refuse(field: string, message: string): never {
  throw new AppError(422, 'validation-failed', message, [{ field, code: 'required', message }]);
}
