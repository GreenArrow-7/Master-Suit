import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { NotFound, Conflict } from '@/lib/errors';
import { enqueue, queueHasWorkers } from '@/lib/queue';
import { analyseAndAudit } from '@/services/shared/callIntelligence';

const params = z.object({ id: z.string().cuid() });

/**
 * Requests an analysis. Does not wait for one.
 *
 * This handler used to call Gemini inline: seconds of held connection, a 500
 * when the model was down, and a row stranded in PROCESSING whenever the client
 * gave up. The work now runs on the `ai` queue with backoff and a recorded
 * failure message, and this returns the row so the caller can poll GET.
 *
 * A second press is refused with a 409 while a run is in flight, but the claim
 * itself belongs to the service — the one lock both the worker and the inline
 * path go through.
 */
export const POST = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, auditEvent: 'AI_ANALYSIS_COMPLETED' },
  async ({ ctx, params }) => {
    const [call, transcript] = await Promise.all([
      prisma.call.findFirst({ where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null } }),
      prisma.transcript.findFirst({ where: { callId: params.id, tenantId: ctx.tenantId } }),
    ]);

    if (!call) throw NotFound('Call');
    if (!transcript) throw NotFound('Transcript — upload a transcript before requesting analysis');

    // Read-only refusal, not a claim: the service's own `claimAnalysis` is the
    // single lock. When this route claimed too, the service then found the row
    // already PROCESSING and skipped — stranding every manual analysis, queued
    // or inline, in PROCESSING forever.
    const existing = await prisma.aIAnalysis.findFirst({
      where: { callId: params.id, tenantId: ctx.tenantId },
      select: { status: true },
    });
    if (existing?.status === 'PROCESSING') {
      throw Conflict('Analysis is already in progress for this call.');
    }

    if (await queueHasWorkers('ai')) {
      await enqueue('ai', 'analyse', { tenantId: ctx.tenantId, callId: params.id }, { fresh: true });
    } else {
      // No worker is draining the queue (dev/demo box). Run the chain in the
      // background of this request; the claim above still guards double-runs
      // and the row records FAILED on error, exactly as the worker path does.
      const tenantId = ctx.tenantId;
      const callId = params.id;
      void analyseAndAudit(tenantId, callId).catch((err) =>
        logger.error({ err: (err as Error).message, callId }, 'inline analysis chain failed'),
      );
    }

    return prisma.aIAnalysis.findFirst({ where: { callId: params.id, tenantId: ctx.tenantId } });
  },
);

export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const analysis = await prisma.aIAnalysis.findFirst({
      where: { callId: params.id, tenantId: ctx.tenantId },
    });
    if (!analysis) throw NotFound('Analysis');
    return analysis;
  },
);

const correctionBody = z
  .object({
    summary: z.string().max(5000).optional(),
    clientNeeds: z.array(z.string()).optional(),
    objections: z.array(z.string()).optional(),
    commitments: z.array(z.string()).optional(),
    nextSteps: z.array(z.string()).optional(),
    topicsMissed: z.array(z.string()).optional(),
    sentiment: z.string().max(50).optional(),
  })
  .strict();

/**
 * A human correcting the model.
 *
 * `humanCorrected` is set and never cleared: once a person has edited a summary,
 * a later re-run must not quietly overwrite their words with the model's. The
 * worker writes the whole row, so a workspace that re-analyses a corrected call
 * loses the correction — which is why re-analysis is an explicit action rather
 * than something the pipeline does on its own.
 */
export const PATCH = route(
  {
    module: 'calls',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body: correctionBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    const analysis = await prisma.aIAnalysis.findFirst({
      where: { callId: params.id, tenantId: ctx.tenantId },
    });
    if (!analysis) throw NotFound('Analysis');

    return prisma.aIAnalysis.update({
      where: { callId: params.id, tenantId: ctx.tenantId },
      data: {
        ...body,
        humanCorrected: true,
        correctedById: ctx.actor.id,
        correctedAt: new Date(),
      },
    });
  },
);
