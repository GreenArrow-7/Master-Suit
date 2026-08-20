import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Forbidden, NotFound, TooManyRequests } from '@/lib/errors';
import { scopeFor, SCOPE_RANK } from '@/lib/security/rbac';
import { resolveOwnerIds } from '@/lib/security/visibility';
import { buildBrief, practiceMaxScore, type PracticeScenario } from '@/lib/ai/practice';

const SCENARIOS = ['OPENER', 'DISCOVERY', 'OBJECTION', 'CLOSE'] as const;

const createBody = z
  .object({
    scenario: z.enum(SCENARIOS),
    /** Required in practice for OBJECTION, so the prospect has something to object to. */
    objectionId: z.string().cuid().optional(),
  })
  .strict();

/**
 * Starts a roleplay session.
 *
 * The rep speaks first — this creates the session and returns it with no turns.
 * Opening for them would remove the one thing an OPENER scenario is for.
 *
 * The daily cap is counted here rather than enforced by the rate limiter,
 * because it is a workspace's spending decision (every turn is a billed model
 * call) and not a defence against abuse: it has to be visible in the settings
 * screen, different per workspace, and reported back to the rep as a number.
 */
export const POST = route(
  { module: 'calls', productModule: 'SALES', action: 'CREATE', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    const settings = await prisma.organizationSetting.findFirst({
      where: { tenantId: ctx.tenantId },
      select: { practiceDailyCap: true },
    });
    const cap = settings?.practiceDailyCap ?? 10;
    if (cap <= 0) throw Forbidden('Roleplay practice is switched off for this workspace.');

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const used = await prisma.practiceSession.count({
      where: { tenantId: ctx.tenantId, userId: ctx.actor.id, startedAt: { gte: since } },
    });
    if (used >= cap) {
      throw TooManyRequests(`You have used all ${cap} practice sessions for today. They reset at midnight.`);
    }

    let objection: { name: string; triggerPhrases: string[] } | null = null;
    if (body.objectionId) {
      objection = await prisma.objection.findFirst({
        where: { id: body.objectionId, tenantId: ctx.tenantId, deletedAt: null },
        select: { name: true, triggerPhrases: true },
      });
      if (!objection) throw NotFound('Objection');
    }

    const session = await prisma.practiceSession.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.actor.id,
        scenario: body.scenario,
        objectionId: body.objectionId ?? null,
        brief: buildBrief(body.scenario as PracticeScenario, objection),
      },
    });

    return {
      ...session,
      maxScore: practiceMaxScore(body.scenario as PracticeScenario),
      remainingToday: cap - used - 1,
    };
  },
);

const listQuery = z
  .object({
    userId: z.string().cuid().optional(),
    scenario: z.enum(SCENARIOS).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

/**
 * Practice history.
 *
 * A rep sees their own; a manager sees the reps their `calls:VIEW` scope
 * already covers, resolved through the same helper the lead lists use rather
 * than a second interpretation of the hierarchy.
 */
export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const scope = scopeFor(ctx, 'calls', 'VIEW');
    const where: Record<string, unknown> = { tenantId: ctx.tenantId };

    if (SCOPE_RANK[scope] < SCOPE_RANK.TEAM) {
      where.userId = ctx.actor.id;
    } else if (scope === 'ORGANIZATION') {
      if (query.userId) where.userId = query.userId;
    } else {
      const visible = await resolveOwnerIds(ctx, scope);
      where.userId = query.userId && visible.includes(query.userId) ? query.userId : { in: visible };
    }

    if (query.scenario) where.scenario = query.scenario;

    const data = await prisma.practiceSession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: query.limit,
      select: {
        id: true,
        scenario: true,
        status: true,
        startedAt: true,
        completedAt: true,
        user: { select: { id: true, fullName: true } },
        score: { select: { overallScore: true, maxScore: true, status: true } },
      },
    });

    return { data };
  },
);
