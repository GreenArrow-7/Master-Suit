import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Conflict } from '@/lib/errors';

/**
 * The objection playbook: what this workspace considers an objection, and what
 * it has decided a good answer sounds like.
 *
 * Gated on `calls`, at the same actions the scorecard endpoints use. The
 * playbook is workspace-wide configuration for the call module, and giving it a
 * permission module of its own would mean every existing role losing access to a
 * feature until somebody edited it — the module list is seeded, not inferred.
 */
const phrases = z.array(z.string().min(2).max(200)).max(50);

const createBody = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).default([]),
    triggerPhrases: phrases.default([]),
    recommendedResponses: z.array(z.string().min(2).max(2000)).max(20).default([]),
    isActive: z.boolean().default(true),
  })
  .strict();

export const POST = route(
  { module: 'calls', productModule: 'SALES', action: 'CREATE', body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) => {
    // `name` is unique per workspace, so a duplicate is a 409 rather than the
    // 500 a raw unique-violation would surface as.
    const clash = await prisma.objection.findFirst({
      where: { tenantId: ctx.tenantId, name: body.name, deletedAt: null },
      select: { id: true },
    });
    if (clash) throw Conflict('An objection with that name already exists.');

    return prisma.objection.create({
      data: { tenantId: ctx.tenantId, createdById: ctx.actor.id, updatedById: ctx.actor.id, ...body },
    });
  },
);

const listQuery = z
  .object({
    active: z.enum(['true', 'false']).optional(),
    tag: z.string().max(40).optional(),
    q: z.string().max(100).optional(),
  })
  .strict();

export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', query: listQuery },
  async ({ ctx, query }) => {
    const where: Record<string, unknown> = { tenantId: ctx.tenantId, deletedAt: null };
    if (query.active === 'true') where.isActive = true;
    else if (query.active === 'false') where.isActive = false;
    if (query.tag) where.tags = { has: query.tag };
    if (query.q) where.name = { contains: query.q, mode: 'insensitive' };

    const data = await prisma.objection.findMany({ where, orderBy: { name: 'asc' }, take: 200 });
    return { data };
  },
);
