import { withTx, prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { audit } from '@/lib/security/audit';
import { can, type Ctx } from '@/lib/security/rbac';
import { nextReference } from '../shared/reference';
import { emit } from '../shared/events';
import { enqueue } from '@/lib/queue';

export interface CreateOpportunityInput {
  name: string;
  leadId?: string;
  accountId?: string;
  contactId?: string;
  pipelineId?: string;
  stageId?: string;
  ownerId?: string;
  amount?: number;
  currency?: string;
  expectedCloseDate?: string;
  tags?: string[];
  custom?: Record<string, unknown>;
  [k: string]: unknown;
}

/** Same shape as createLead: resolve pipeline/stage, commit fast, defer side effects to queues. */
export async function createOpportunity(ctx: Ctx, input: CreateOpportunityInput) {
  const pipeline = input.pipelineId
    ? await prisma.pipeline.findFirst({ where: { tenantId: ctx.tenantId, id: input.pipelineId } })
    : await prisma.pipeline.findFirst({ where: { tenantId: ctx.tenantId, isDefault: true } });
  if (!pipeline) throw NotFound('Pipeline');

  const stage = input.stageId
    ? await prisma.pipelineStage.findFirst({
        where: { tenantId: ctx.tenantId, pipelineId: pipeline.id, id: input.stageId },
      })
    : await prisma.pipelineStage.findFirst({
        where: { tenantId: ctx.tenantId, pipelineId: pipeline.id },
        orderBy: { position: 'asc' },
      });
  if (!stage) throw NotFound('Pipeline stage');

  const ownerId = input.ownerId && can(ctx, 'opportunities', 'ASSIGN') ? input.ownerId : ctx.actor.id;

  const opportunity = await withTx(ctx.tenantId, async (tx) => {
    const reference = await nextReference(tx, ctx.tenantId, 'OPPORTUNITY');

    const created = await tx.opportunity.create({
      data: {
        tenantId: ctx.tenantId,
        reference,
        name: input.name,
        leadId: input.leadId ?? null,
        accountId: input.accountId ?? null,
        contactId: input.contactId ?? null,
        pipelineId: pipeline.id,
        stageId: stage.id,
        probability: stage.probability,
        ownerId,
        amount: input.amount ?? 0,
        currency: input.currency ?? 'AED',
        expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
        tags: input.tags ?? [],
        customData: (input.custom ?? {}) as any,
        createdById: ctx.actor.id,
        updatedById: ctx.actor.id,
      },
    });

    await tx.opportunityStageHistory.create({
      data: { tenantId: ctx.tenantId, opportunityId: created.id, toStageId: stage.id, changedById: ctx.actor.id },
    });

    await audit(
      ctx,
      {
        event: 'RECORD_CREATED',
        objectType: 'opportunity',
        recordId: created.id,
        newValue: { reference, stage: stage.key },
      },
      tx,
    );
    return created;
  });

  await enqueue('automation', 'trigger', {
    tenantId: ctx.tenantId,
    event: 'record.created',
    object: 'OPPORTUNITY',
    recordId: opportunity.id,
  });
  emit(ctx, 'opportunity.created', { opportunityId: opportunity.id });
  return opportunity;
}
