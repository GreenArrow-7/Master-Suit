import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { auditCall } from '@/lib/ai/audit';

const params = z.object({ id: z.string().cuid() });

const auditBody = z.object({
  scorecardId: z.string().cuid(),
}).strict();

export const POST = route(
  { module: 'calls', action: 'EDIT', params, body: auditBody, auditEvent: 'CALL_AUDIT_COMPLETED' },
  async ({ ctx, params, body }) => {
    const [call, transcript, analysis, scorecard] = await Promise.all([
      prisma.call.findFirst({ where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null } }),
      prisma.transcript.findFirst({ where: { callId: params.id, tenantId: ctx.tenantId } }),
      prisma.aIAnalysis.findFirst({ where: { callId: params.id, tenantId: ctx.tenantId, status: 'COMPLETED' } }),
      prisma.auditScorecard.findFirst({
        where: { id: body.scorecardId, tenantId: ctx.tenantId, isActive: true },
        include: { criteria: { orderBy: { position: 'asc' } } },
      }),
    ]);

    if (!call) throw NotFound('Call');
    if (!transcript) throw NotFound('Transcript');
    if (!analysis) throw NotFound('Completed analysis — run analysis first');
    if (!scorecard) throw NotFound('Active scorecard');

    const callAudit = await prisma.callAudit.create({
      data: {
        tenantId: ctx.tenantId,
        callId: params.id,
        scorecardId: body.scorecardId,
        status: 'PROCESSING',
      },
    });

    try {
      const result = await auditCall({
        transcript: transcript.content,
        analysisJson: {
          summary: analysis.summary,
          clientNeeds: analysis.clientNeeds,
          objections: analysis.objections,
          commitments: analysis.commitments,
          topicsDiscussed: analysis.topicsDiscussed,
          topicsMissed: analysis.topicsMissed,
          sentiment: analysis.sentiment,
        },
        criteria: scorecard.criteria.map((c) => ({
          label: c.label,
          description: c.description ?? undefined,
          weight: c.weight,
          isRequired: c.isRequired,
        })),
      });

      return prisma.callAudit.update({
        where: { id: callAudit.id },
        data: {
          status: 'COMPLETED',
          overallScore: result.overallScore,
          maxScore: result.maxScore,
          criteriaScores: result.criteriaScores as any,
          missedPoints: result.missedPoints,
          strengths: result.strengths,
          risks: result.risks,
          suggestions: result.suggestions,
          nextAction: result.nextAction,
        },
      });
    } catch (err: any) {
      await prisma.callAudit.update({
        where: { id: callAudit.id },
        data: { status: 'FAILED', errorMessage: err.message?.slice(0, 500) },
      });
      throw err;
    }
  },
);

export const GET = route(
  { module: 'calls', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const data = await prisma.callAudit.findMany({
      where: { callId: params.id, tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return { data };
  },
);

const reviewBody = z.object({
  auditId: z.string().cuid(),
}).strict();

export const PATCH = route(
  { module: 'calls', action: 'EDIT', params, body: reviewBody, auditEvent: 'RECORD_UPDATED' },
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
