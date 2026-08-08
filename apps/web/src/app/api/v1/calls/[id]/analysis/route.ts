import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Conflict } from '@/lib/errors';
import { enqueue } from '@/lib/queue';
import { claimAnalysis } from '@/services/shared/callIntelligence';

const params = z.object({ id: z.string().cuid() });

/**
 * Requests an analysis. Does not wait for one.
 *
 * This handler used to call Gemini inline: seconds of held connection, a 500
 * when the model was down, and a row stranded in PROCESSING whenever the client
 * gave up. The work now runs on the `ai` queue with backoff and a recorded
 * failure message, and this returns the row so the caller can poll GET.
 *
 * The row is still claimed *here* rather than in the worker, so a second press
 * of the button is refused immediately with a 409 instead of silently queueing a
 * second billed model call.
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
    if (!(await claimAnalysis(ctx.tenantId, params.id))) {
      throw Conflict('Analysis is already in progress for this call.');
    }

    await enqueue('ai', 'analyse', { tenantId: ctx.tenantId, callId: params.id });

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
