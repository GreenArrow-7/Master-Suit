import { withTenantTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { auditDiff } from '@/lib/security/audit';
import { assertRecordVisible } from '@/lib/security/visibility';
import { can, type Ctx } from '@/lib/security/rbac';
import { enqueue } from '@/lib/queue';
import { emit } from '../shared/events';

export interface UpdateOpportunityInput {
  name?: string;
  stageId?: string;
  ownerId?: string | null;
  amount?: number;
  currency?: string;
  expectedCloseDate?: string | null;
  status?: 'OPEN' | 'WON' | 'LOST' | 'ABANDONED';
  lossReasonId?: string;
  lossNotes?: string;
  tags?: string[];
  [k: string]: unknown;
}

export async function updateOpportunity(ctx: Ctx, id: string, input: UpdateOpportunityInput) {
  if (input.ownerId !== undefined && !can(ctx, 'opportunities', 'ASSIGN') && !can(ctx, 'opportunities', 'REASSIGN')) {
    delete input.ownerId;
  }

  const updated = await withTenantTx(ctx.tenantId, async (tx) => {
    const before = await tx.opportunity.findFirst({ where: { tenantId: ctx.tenantId, id } });
    if (!before) throw NotFound('Opportunity');
    await assertRecordVisible(ctx, 'opportunities', before, 'EDIT');

    let probability = before.probability;
    if (input.stageId && input.stageId !== before.stageId) {
      const stage = await tx.pipelineStage.findFirst({ where: { tenantId: ctx.tenantId, pipelineId: before.pipelineId, id: input.stageId } });
      if (!stage) throw NotFound('Pipeline stage');
      probability = stage.probability;
      await tx.opportunityStageHistory.create({
        data: { tenantId: ctx.tenantId, opportunityId: id, fromStageId: before.stageId, toStageId: stage.id, changedById: ctx.actor.id },
      });
    }

    const closing = input.status === 'WON' || input.status === 'LOST';

    const after = await tx.opportunity.update({
      where: { tenantId: ctx.tenantId, id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.stageId !== undefined && { stageId: input.stageId, probability, stageEnteredAt: new Date() }),
        ...(input.ownerId !== undefined && { ownerId: input.ownerId }),
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.expectedCloseDate !== undefined && {
          expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
        }),
        ...(input.status !== undefined && { status: input.status }),
        ...(closing && { actualCloseDate: new Date() }),
        ...(input.lossReasonId !== undefined && { lossReasonId: input.lossReasonId }),
        ...(input.lossNotes !== undefined && { lossNotes: input.lossNotes }),
        ...(input.tags !== undefined && { tags: input.tags }),
        updatedById: ctx.actor.id,
      },
    });

    await auditDiff(ctx, 'opportunity', id, before, after, tx);
    return after;
  });

  await enqueue('automation', 'trigger', { tenantId: ctx.tenantId, event: 'record.updated', object: 'OPPORTUNITY', recordId: id });
  emit(ctx, updated.status === 'WON' ? 'opportunity.won' : updated.status === 'LOST' ? 'opportunity.lost' : 'opportunity.updated', { opportunityId: id });
  return updated;
}

export async function deleteOpportunity(ctx: Ctx, id: string) {
  await withTenantTx(ctx.tenantId, async (tx) => {
    const before = await tx.opportunity.findFirst({ where: { tenantId: ctx.tenantId, id } });
    if (!before) throw NotFound('Opportunity');
    await assertRecordVisible(ctx, 'opportunities', before, 'DELETE');
    await tx.opportunity.update({ where: { tenantId: ctx.tenantId, id }, data: { deletedAt: new Date(), updatedById: ctx.actor.id } });
    await auditDiff(ctx, 'opportunity', id, before, { ...before, deletedAt: new Date() }, tx);
  });
}
