import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Conflict } from '@/lib/errors';
import { analyzeTranscript } from '@/lib/ai/analysis';

const params = z.object({ id: z.string().cuid() });

export const POST = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, auditEvent: 'AI_ANALYSIS_COMPLETED' },
  async ({ ctx, params }) => {
    const [call, transcript, existing] = await Promise.all([
      prisma.call.findFirst({ where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null } }),
      prisma.transcript.findFirst({ where: { callId: params.id, tenantId: ctx.tenantId } }),
      prisma.aIAnalysis.findFirst({ where: { callId: params.id, tenantId: ctx.tenantId, status: 'PROCESSING' } }),
    ]);

    if (!call) throw NotFound('Call');
    if (!transcript) throw NotFound('Transcript — upload a transcript before requesting analysis');
    if (existing) throw Conflict('Analysis is already in progress for this call.');

    // Fetch campaign talking points and qualifications if campaign-linked
    let talkingPoints: { label: string; isRequired: boolean }[] = [];
    let qualifications: { question: string; expectedAnswer?: string | null }[] = [];
    let campaignName: string | undefined;

    if (call.campaignId) {
      const [tps, qs, campaign] = await Promise.all([
        prisma.campaignTalkingPoint.findMany({
          where: { tenantId: ctx.tenantId, campaignId: call.campaignId },
          select: { label: true, isRequired: true },
        }),
        prisma.campaignQualification.findMany({
          where: { tenantId: ctx.tenantId, campaignId: call.campaignId },
          select: { question: true, expectedAnswer: true },
        }),
        prisma.campaign.findFirst({
          where: { id: call.campaignId, tenantId: ctx.tenantId },
          select: { name: true },
        }),
      ]);
      talkingPoints = tps;
      qualifications = qs;
      campaignName = campaign?.name ?? undefined;
    }

    try {
      const { result, modelId, processingMs } = await analyzeTranscript({
        transcript: transcript.content,
        talkingPoints,
        qualifications: qualifications.map((q) => ({
          question: q.question,
          expectedAnswer: q.expectedAnswer ?? undefined,
        })),
        callDirection: call.direction,
        campaignName,
      });

      return prisma.aIAnalysis.update({
        where: { callId: params.id },
        data: {
          status: 'COMPLETED',
          modelId,
          processingMs,
          summary: result.summary,
          clientNeeds: result.clientNeeds,
          objections: result.objections,
          commitments: result.commitments,
          buyingSignals: result.buyingSignals,
          risks: result.risks,
          nextSteps: result.nextSteps,
          topicsDiscussed: result.topicsDiscussed,
          topicsMissed: result.topicsMissed,
          sentiment: result.sentiment,
          sentimentScore: result.sentimentScore,
          suggestedStatus: result.suggestedStatus,
          complianceFlags: result.complianceFlags,
          uncertainItems: result.uncertainItems,
          rawOutput: result as any,
        },
      });
    } catch (err: any) {
      await prisma.aIAnalysis.update({
        where: { callId: params.id },
        data: { status: 'FAILED', errorMessage: err.message?.slice(0, 500) },
      });
      throw err;
    }
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
      where: { callId: params.id },
      data: {
        ...body,
        humanCorrected: true,
        correctedById: ctx.actor.id,
        correctedAt: new Date(),
      },
    });
  },
);
