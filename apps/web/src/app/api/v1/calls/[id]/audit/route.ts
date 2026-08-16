import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Conflict, NotFound } from '@/lib/errors';
import { enqueue, queueHasWorkers } from '@/lib/queue';
import { logger } from '@/lib/logger';
import { runCallAudit } from '@/services/shared/callIntelligence';

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

    // The PROCESSING check above is the whole refusal; the service claims the
    // row itself. When this route also flipped it to PROCESSING, `runCallAudit`
    // then saw an in-progress row and skipped — stranding every manual re-audit.
    // Queue when a worker is listening, inline when this box is all there is.
    const job = { tenantId: ctx.tenantId, callId: params.id, scorecardId: body.scorecardId };
    if (await queueHasWorkers('ai')) {
      await enqueue('ai', 'audit', job, { fresh: true });
    } else {
      void runCallAudit(job).catch((err) => logger.error({ err, callId: params.id }, 'inline audit failed'));
    }
    return { status: 'QUEUED', existingAuditId: existing?.id ?? null };
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
      where: { id: body.auditId, tenantId: ctx.tenantId },
      data: { humanReviewed: true, reviewedById: ctx.actor.id, reviewedAt: new Date() },
    });
  },
);

const deleteQuery = z.object({ auditId: z.string().cuid() }).strict();

/**
 * Removes one audit verdict. `calls:DELETE` is held only by the administrator
 * roles (wildcard grants) — QA managers review audits, they do not erase them,
 * and the deletion itself lands in the audit log like every other destructive
 * action.
 */
export const DELETE = route(
  { module: 'calls', productModule: 'SALES', action: 'DELETE', params, query: deleteQuery, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params, query }) => {
    const audit = await prisma.callAudit.findFirst({
      where: { id: query.auditId, callId: params.id, tenantId: ctx.tenantId },
      select: { id: true },
    });
    if (!audit) throw NotFound('Call audit');

    await prisma.callAudit.delete({ where: { id: audit.id, tenantId: ctx.tenantId } });
    return { ok: true };
  },
);
