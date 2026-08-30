import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound, Invalid } from '@/lib/errors';
import { assertRecordVisible } from '@/lib/security/visibility';
import { temperatureFromAnalysis } from '@/lib/ai/temperature';

const params = z.object({ id: z.string().cuid() });

/**
 * Apply the post-call temperature to the lead — the agent's explicit act.
 *
 * The result is recomputed here from the stored analysis, never trusted from
 * the client: what gets written to a lead's score must be derivable from the
 * call record it claims to come from. The change lands as score + quality plus
 * a LeadScoreHistory row carrying the reasons, so the number stays explainable
 * after the fact.
 */
export const POST = route(
  { module: 'leads', productModule: 'SALES', action: 'EDIT', params, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params }) => {
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, leadId: true },
    });
    if (!call) throw NotFound('Call');
    if (!call.leadId) throw Invalid([{ field: 'leadId', code: 'missing', message: 'This call has no linked lead.' }]);

    const [analysis, lead] = await Promise.all([
      prisma.aIAnalysis.findFirst({ where: { callId: call.id, tenantId: ctx.tenantId, status: 'COMPLETED' } }),
      prisma.lead.findFirst({
        where: { id: call.leadId, tenantId: ctx.tenantId },
        select: { id: true, tenantId: true, ownerId: true, score: true },
      }),
    ]);
    if (!analysis) throw Invalid([{ field: 'analysis', code: 'missing', message: 'The call has no completed analysis.' }]);
    if (!lead) throw NotFound('Lead');
    await assertRecordVisible(ctx, 'leads', lead, prisma);

    const result = temperatureFromAnalysis(analysis);

    await prisma.$transaction([
      prisma.lead.update({
        where: { id: lead.id, tenantId: ctx.tenantId },
        data: { score: result.score, quality: result.temperature },
      }),
      prisma.leadScoreHistory.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: lead.id,
          delta: result.score - lead.score,
          scoreAfter: result.score,
          reason: `Post-call AI temperature ${result.temperature}: ${result.reasons
            .map((r) => `${r.delta > 0 ? '+' : ''}${r.delta} ${r.text}`)
            .join('; ')}`.slice(0, 900),
        },
      }),
    ]);

    return { applied: true, previousScore: lead.score, ...result };
  },
);
