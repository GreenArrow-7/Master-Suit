import { withTx } from '@/lib/db';
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

  const updated = await withTx(ctx.tenantId, async (tx) => {
    const before = await tx.opportunity.findFirst({ where: { tenantId: ctx.tenantId, id } });
    if (!before) throw NotFound('Opportunity');
    await assertRecordVisible(ctx, 'opportunities', before, tx, 'EDIT');

    /**
     * Closing an opportunity moves it to the pipeline's terminal stage.
     *
     * This used to set `status` and `actualCloseDate` and nothing else, so a
     * deal marked WON kept whatever stage it was closed from: the detail page
     * showed "WON" in the header and "Qualification · 10%" in the stage bar,
     * and every pipeline report counted the deal as still sitting mid-funnel.
     * (The seed's WON rows looked right only because the seed wrote stage and
     * status together; anything closed through the product did not.)
     *
     * The pipeline already knows its terminal stages — `category` is CONVERSION
     * for won and TERMINAL_NEGATIVE for lost — so the status change implies the
     * stage change, unless the caller picked a stage explicitly in the same
     * request, which stays theirs. A pipeline with no terminal stage keeps the
     * current one rather than failing the close; probability still snaps to
     * 100/0, because "won at 10% likely" is the wrong answer in any pipeline.
     */
    let effectiveStageId = input.stageId;
    if (!effectiveStageId && (input.status === 'WON' || input.status === 'LOST')) {
      const terminal = await tx.pipelineStage.findFirst({
        where: {
          tenantId: ctx.tenantId,
          pipelineId: before.pipelineId,
          category: input.status === 'WON' ? 'CONVERSION' : 'TERMINAL_NEGATIVE',
        },
        orderBy: { position: 'asc' },
      });
      if (terminal && terminal.id !== before.stageId) effectiveStageId = terminal.id;
    }

    let probability = before.probability;
    if (effectiveStageId && effectiveStageId !== before.stageId) {
      const stage = await tx.pipelineStage.findFirst({
        where: { tenantId: ctx.tenantId, pipelineId: before.pipelineId, id: effectiveStageId },
      });
      if (!stage) throw NotFound('Pipeline stage');
      probability = stage.probability;
      await tx.opportunityStageHistory.create({
        data: {
          tenantId: ctx.tenantId,
          opportunityId: id,
          fromStageId: before.stageId,
          toStageId: stage.id,
          changedById: ctx.actor.id,
        },
      });
    }
    if (input.status === 'WON') probability = 100;
    if (input.status === 'LOST') probability = 0;

    const closing = input.status === 'WON' || input.status === 'LOST';
    // Reopening clears the close date the close set — a live deal with an
    // "actual close" on it reads as already over in every list that shows it.
    const reopening = input.status === 'OPEN' && before.status !== 'OPEN';

    const after = await tx.opportunity.update({
      where: { tenantId: ctx.tenantId, id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(effectiveStageId !== undefined && {
          stageId: effectiveStageId,
          probability,
          stageEnteredAt: new Date(),
        }),
        ...(closing && effectiveStageId === undefined && { probability }),
        ...(input.ownerId !== undefined && { ownerId: input.ownerId }),
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.expectedCloseDate !== undefined && {
          expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
        }),
        ...(input.status !== undefined && { status: input.status }),
        ...(closing && { actualCloseDate: new Date() }),
        ...(reopening && { actualCloseDate: null }),
        // A deal corrected from LOST to WON must not keep its loss reason —
        // reports group by it, and a won deal under "priced too high" is noise.
        ...(input.status === 'WON' && { lossReasonId: null, lossNotes: null }),
        ...(input.lossReasonId !== undefined && { lossReasonId: input.lossReasonId }),
        ...(input.lossNotes !== undefined && { lossNotes: input.lossNotes }),
        ...(input.tags !== undefined && { tags: input.tags }),
        updatedById: ctx.actor.id,
      },
    });

    await auditDiff(ctx, 'opportunity', id, before, after, tx);
    return after;
  });

  await enqueue('automation', 'trigger', {
    tenantId: ctx.tenantId,
    event: 'record.updated',
    object: 'OPPORTUNITY',
    recordId: id,
  });
  emit(
    ctx,
    updated.status === 'WON'
      ? 'opportunity.won'
      : updated.status === 'LOST'
        ? 'opportunity.lost'
        : 'opportunity.updated',
    { opportunityId: id },
  );
  return updated;
}

export async function deleteOpportunity(ctx: Ctx, id: string) {
  await withTx(ctx.tenantId, async (tx) => {
    const before = await tx.opportunity.findFirst({ where: { tenantId: ctx.tenantId, id } });
    if (!before) throw NotFound('Opportunity');
    await assertRecordVisible(ctx, 'opportunities', before, tx, 'DELETE');
    await tx.opportunity.update({
      where: { tenantId: ctx.tenantId, id },
      data: { deletedAt: new Date(), updatedById: ctx.actor.id },
    });
    await auditDiff(ctx, 'opportunity', id, before, { ...before, deletedAt: new Date() }, tx);
  });
}
