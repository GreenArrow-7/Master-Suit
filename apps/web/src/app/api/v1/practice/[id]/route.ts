import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { Conflict, Forbidden, Invalid, NotFound } from '@/lib/errors';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { resolveOwnerIds } from '@/lib/security/visibility';
import { enqueue, queueHasWorkers } from '@/lib/queue';
import { prospectReply, type PracticeTurn } from '@/lib/ai/practice';
import { scorePracticeSession } from '@/services/shared/practiceScoring';
import type { Ctx } from '@/lib/security/rbac';

const params = z.object({ id: z.string().cuid() });

/**
 * Loads a session the caller may see: their own always; someone else's only
 * when their calls:VIEW scope covers that person — a session transcript is a
 * rep rehearsing, and it is shown to the same managers who can hear their real
 * calls, not to peers.
 */
async function loadVisible(ctx: Ctx, id: string) {
  const session = await prisma.practiceSession.findFirst({
    where: { id, tenantId: ctx.tenantId },
    include: { score: true, user: { select: { id: true, fullName: true } } },
  });
  if (!session) throw NotFound('Practice session');
  if (session.userId !== ctx.actor.id) {
    const scope = scopeFor(ctx, 'calls', 'VIEW');
    if (SCOPE_RANK[scope] < SCOPE_RANK.TEAM) throw Forbidden();
    if (scope !== 'ORGANIZATION' && !(await resolveOwnerIds(ctx, scope)).includes(session.userId)) {
      throw Forbidden();
    }
  }
  return session;
}

export const GET = route({ module: 'calls', productModule: 'SALES', action: 'VIEW', params }, async ({ ctx, params }) =>
  loadVisible(ctx, params.id),
);

const turnBody = z.object({ text: z.string().min(1).max(2000) }).strict();

/**
 * One rep turn → one prospect reply, appended to the session.
 *
 * Synchronous, unlike every other model call in this module: a conversation
 * with a queue in the middle is not a conversation. The reply is capped at 30s,
 * degrades to the scripted prospect on failure, and only ever runs for the
 * session's own rep — so the blast radius of a slow model is the one person
 * practising, who is watching a typing indicator either way.
 */
export const POST = route(
  {
    module: 'calls',
    productModule: 'SALES',
    action: 'EDIT',
    params,
    body: turnBody,
    // Each turn is a billed model call.
    rateLimit: { max: 30, windowSeconds: 60 },
  },
  async ({ ctx, params, body }) => {
    const session = await prisma.practiceSession.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId },
    });
    if (!session) throw NotFound('Practice session');
    // Turns are the rep's own; a manager reviews, they do not ghost-write.
    if (session.userId !== ctx.actor.id) throw Forbidden('Only the session owner can practise in it.');
    if (session.status !== 'IN_PROGRESS') throw Conflict('This session has ended.');

    const turns = session.turns as unknown as PracticeTurn[];
    if (turns.length >= 60) throw Conflict('This session is long enough — finish it and get your score.');

    const now = new Date().toISOString();
    const withRep: PracticeTurn[] = [...turns, { role: 'REP', text: body.text, at: now }];

    const reply = await prospectReply({ tenantId: ctx.tenantId, brief: session.brief, turns: withRep });
    const withProspect: PracticeTurn[] = [
      ...withRep,
      { role: 'PROSPECT', text: reply.text, at: new Date().toISOString() },
    ];

    /**
     * Compare-and-swap on the turn count. Two tabs posting into the same
     * session converge on one accepted turn instead of silently interleaving
     * two conversations; the loser gets a 409 and refetches.
     */
    const updated = await prisma.practiceSession.updateMany({
      where: { id: params.id, tenantId: ctx.tenantId, status: 'IN_PROGRESS' },
      data: { turns: withProspect as unknown as object },
    });
    if (updated.count === 0) throw Conflict('The session changed underneath you — reload it.');

    return { turns: withProspect, prospectEnded: reply.ended, source: reply.source };
  },
);

const finishBody = z.object({ outcome: z.enum(['COMPLETED', 'ABANDONED']).default('COMPLETED') }).strict();

/**
 * Ends the session. COMPLETED queues scoring; ABANDONED just closes it —
 * scoring a two-line session the rep gave up on would put a meaningless number
 * on their record.
 */
export const PATCH = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, body: finishBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    const session = await prisma.practiceSession.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId },
    });
    if (!session) throw NotFound('Practice session');
    if (session.userId !== ctx.actor.id) throw Forbidden('Only the session owner can finish it.');
    if (session.status !== 'IN_PROGRESS') throw Conflict('This session has already ended.');

    const turns = session.turns as unknown as PracticeTurn[];
    if (body.outcome === 'COMPLETED' && turns.filter((t) => t.role === 'REP').length < 2) {
      throw Invalid([
        { field: 'outcome', code: 'too_short', message: 'Say at least two things before asking to be scored.' },
      ]);
    }

    await prisma.practiceSession.update({
      where: { id: params.id, tenantId: ctx.tenantId },
      data: { status: body.outcome, completedAt: new Date() },
    });

    if (body.outcome === 'COMPLETED') {
      // The PENDING row is what the UI polls; the worker fills it in.
      await prisma.practiceScore.upsert({
        where: { sessionId: params.id, tenantId: ctx.tenantId },
        create: { tenantId: ctx.tenantId, sessionId: params.id, status: 'PENDING' },
        update: { status: 'PENDING', errorMessage: null },
      });

      if (await queueHasWorkers('ai')) {
        await enqueue('ai', 'practice-score', { tenantId: ctx.tenantId, sessionId: params.id });
      } else {
        const tenantId = ctx.tenantId;
        const sessionId = params.id;
        void scorePracticeSession({ tenantId, sessionId }).catch((err) =>
          logger.error({ err: (err as Error).message, sessionId }, 'inline practice scoring failed'),
        );
      }
    }

    return prisma.practiceSession.findFirst({
      where: { id: params.id, tenantId: ctx.tenantId },
      include: { score: true },
    });
  },
);
