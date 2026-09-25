import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Invalid } from '@/lib/errors';
import { findRecyclable, recycleLeads, recyclePolicy } from '@/services/leads/recycling';

/**
 * The recycling queue, its policy, and the button.
 *
 * Gated on REASSIGN rather than EDIT. Recycling takes leads off the agent who
 * lost them and puts them back in the rotation — that is a reassignment, and
 * everyone who can do it by hand can do it here.
 */
export const GET = route(
  { module: 'leads', productModule: 'SALES', action: 'REASSIGN' },
  async ({ ctx }) => {
    const [policy, candidates, stages] = await Promise.all([
      recyclePolicy(ctx.tenantId),
      findRecyclable(ctx.tenantId),
      prisma.leadStage.findMany({
        where: { tenantId: ctx.tenantId, category: 'OPEN', deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
        select: { id: true, name: true },
      }),
    ]);

    return { policy, stages, candidates };
  },
);

const policyBody = z.object({
  /** 0 switches recycling off. Capped at two years: beyond that the phone number is someone else's. */
  afterDays: z.coerce.number().int().min(0).max(730),
  maxTimes: z.coerce.number().int().min(1).max(10),
  returnStageId: z.string().min(1).nullable(),
});

export const PUT = route(
  { module: 'leads', productModule: 'SALES', action: 'REASSIGN', body: policyBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, body }) => {
    // A stage from another workspace, or one that is not somewhere a lead can
    // be worked, would recycle leads into a queue nobody opens.
    if (body.returnStageId) {
      const stage = await prisma.leadStage.findFirst({
        where: { tenantId: ctx.tenantId, id: body.returnStageId, category: 'OPEN', deletedAt: null },
        select: { id: true },
      });
      if (!stage) {
        throw Invalid([
          {
            field: 'returnStageId',
            code: 'not-an-open-stage',
            message: 'That stage is not an open stage in this pipeline.',
          },
        ]);
      }
    }

    await prisma.organizationSetting.update({
      where: { tenantId: ctx.tenantId },
      data: {
        leadRecycleAfterDays: body.afterDays,
        leadRecycleMaxTimes: body.maxTimes,
        leadRecycleStageId: body.returnStageId,
      },
    });

    return { ok: true, policy: await recyclePolicy(ctx.tenantId) };
  },
);

const recycleBody = z.object({
  /** Named leads, or everything the queue says is ready. */
  leadIds: z.array(z.string().min(1)).max(200).optional(),
  all: z.literal(true).optional(),
});

export const POST = route(
  { module: 'leads', productModule: 'SALES', action: 'REASSIGN', body: recycleBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, body }) => {
    const ids = body.all
      ? (await findRecyclable(ctx.tenantId)).filter((row) => row.blocked === null).map((row) => row.id)
      : (body.leadIds ?? []);

    return recycleLeads(ctx, ids);
  },
);
