import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { coachAction } from '@/lib/ai/liveCoach';
import { leadCallContext, contextPromptBlock } from '@/services/leads/callContext';
import { requireVisibleCall } from '@/services/crm/callVisibility';

const params = z.object({ id: z.string().cuid() });
const body = z
  .object({
    action: z.enum([
      'ASK_NEXT',
      'HANDLE_OBJECTION',
      'RECOMMEND_PROPERTY',
      'PAYMENT_PLAN',
      'CLOSING_LINE',
      'SUMMARIZE',
      'TRANSLATE',
    ]),
    /** The rolling transcript window the client already holds — resent rather
     *  than re-read so the button answers on what was just said. */
    window: z.string().max(8000).default(''),
  })
  .strict();

/**
 * The agent quick buttons: one on-demand hint, grounded in the same lead
 * context the live coach ticks carry. Falls back to deterministic wording when
 * no AI provider is configured, so the buttons always answer.
 */
export const POST = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, body },
  async ({ ctx, params, body }) => {
    await requireVisibleCall(ctx, params.id);
    const call = await prisma.call.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId, deletedAt: null },
      select: { id: true, callerId: true, leadId: true },
    });
    if (!call) throw NotFound('Call');
    const scope = scopeFor(ctx, 'calls', 'EDIT');
    if (call.callerId !== ctx.actor.id && SCOPE_RANK[scope] < SCOPE_RANK.TEAM) throw NotFound('Call');

    const context = call.leadId ? await leadCallContext(ctx.tenantId, call.leadId).catch(() => null) : null;
    const hint = await coachAction(
      body.action,
      body.window,
      ctx.tenantId,
      context,
      context ? contextPromptBlock(context) : undefined,
    );
    return { hint };
  },
);
