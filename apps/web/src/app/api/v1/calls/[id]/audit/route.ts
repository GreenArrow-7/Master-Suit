import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Conflict, NotFound } from '@/lib/errors';
import { enqueue } from '@/lib/queue';

const params = z.object({ id: z.string().cuid() });

const auditBody = z
  .object({
    scorecardId: z.string().cuid(),
  })
  .strict();

/**
 * Requests an audit against a scorecard. The model call runs on the `ai` queue.
 *
 * The pipeline already audits automatically once an analysis completes, when the
 * workspace has an active scorecard. This endpoint exists for the other cases: a
 * second scorecard, a re-score after the criteria changed, or a call whose
 * analysis predates the scorecard.
 */
export const POST = route(
  {
    module: 'calls',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body: auditBody,
    auditEvent: 'CALL_AUDIT_COMPLETED',
  },
  async ({ ctx, params, body }) => {
    const [call, analysis, scorecard, existing] = await Promise.all([
      prisma.call.findFirst({ where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null } }),
      prisma.aIAnalysis.findFirst({ where: { callId: params.id, tenantId: ctx.tenantId, status: 'COMPLETED' } }),
      prisma.auditScorecard.findFirst({ where: { id: body.scorecardId, tenantId: ctx.tenantId, isActive: true } }),
      prisma.callAudit.findFirst({
        where: { callId: params.id, tenantId: ctx.tenantId, scorecardId: body.scorecardId },
      }),
    ]);

    if (!call) throw NotFound('Call');
    if (!analysis) throw NotFound('Completed analysis — run analysis first');
    if (!scorecard) throw NotFound('Active scorecard');
    if (existing?.status === 'PROCESSING') throw Conflict('This audit is already in progress.');

    // Claimed here for the same reason as the analysis: a second press must be
    // refused now, not deduplicated later by a worker that has already started.
    const row = existing
      ? await prisma.callAudit.update({
          where: { id: existing.id },
          data: { status: 'PROCESSING', errorMessage: null },
        })
      : await prisma.callAudit.create({
          data: { tenantId: ctx.tenantId, callId: params.id, scorecardId: body.scorecardId, status: 'PROCESSING' },
        });

    await enqueue('ai', 'audit', { tenantId: ctx.tenantId, callId: params.id, scorecardId: body.scorecardId });
    return row;
  },
);

export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const data = await prisma.callAudit.findMany({
      where: { callId: params.id, tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return { data };
  },
);

const reviewBody = z
  .object({
    auditId: z.string().cuid(),
  })
  .strict();

export const PATCH = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, body: reviewBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    const audit = await prisma.callAudit.findFirst({
      where: { id: body.auditId, callId: params.id, tenantId: ctx.tenantId },
    });
    if (!audit) throw NotFound('Call audit');

    return prisma.callAudit.update({
      where: { id: body.auditId },
      data: { humanReviewed: true, reviewedById: ctx.actor.id, reviewedAt: new Date() },
    });
  },
);
