import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Forbidden, NotFound } from '@/lib/errors';
import { scopeFor, SCOPE_RANK, type Ctx } from '@/lib/security/rbac';
import { resolveOwnerIds } from '@/lib/security/visibility';

const params = z.object({ id: z.string().cuid() });

/**
 * Coaching notes on a call.
 *
 * Visibility is the call's visibility: whoever may see the call may read the
 * coaching on it — the rep being coached most of all. Writing requires seeing
 * someone *else's* calls (TEAM or wider), which is the existing definition of
 * "manager" here; a self-note is just the call's own notes field.
 */
async function assertCallVisible(ctx: Ctx, callId: string) {
  const call = await prisma.call.findFirst({
    where: { id: callId, tenantId: ctx.tenantId, deletedAt: null },
    select: { id: true, callerId: true },
  });
  if (!call) throw NotFound('Call');

  const scope = scopeFor(ctx, 'calls', 'VIEW');
  if (call.callerId === ctx.actor.id || scope === 'ORGANIZATION') return call;
  if (SCOPE_RANK[scope] < SCOPE_RANK.TEAM) throw Forbidden();
  if (!(await resolveOwnerIds(ctx, scope)).includes(call.callerId)) throw Forbidden();
  return call;
}

export const GET = route(
  { module: 'calls', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    await assertCallVisible(ctx, params.id);
    const data = await prisma.coachingNote.findMany({
      where: { tenantId: ctx.tenantId, callId: params.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, fullName: true } } },
    });
    return { data };
  },
);

const createBody = z.object({ body: z.string().min(1).max(5000) }).strict();

export const POST = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, body: createBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, params, body }) => {
    const call = await assertCallVisible(ctx, params.id);
    // Coaching is a manager writing about someone *else's* call. Whatever the
    // scope, a note on your own call is just notes — the Call has a field for
    // those — and letting it through here would put self-assessments in the
    // same list managers read as coaching delivered.
    if (call.callerId === ctx.actor.id) {
      throw Forbidden('Coaching notes are written by managers. Use the call notes for your own remarks.');
    }
    // TEAM or wider — the same line that separates "my calls" from "my team's".
    if (SCOPE_RANK[scopeFor(ctx, 'calls', 'VIEW')] < SCOPE_RANK.TEAM) throw Forbidden();

    return prisma.coachingNote.create({
      data: { tenantId: ctx.tenantId, callId: params.id, authorId: ctx.actor.id, body: body.body },
      include: { author: { select: { id: true, fullName: true } } },
    });
  },
);

const patchBody = z
  .object({
    noteId: z.string().cuid(),
    /** true marks it acted on; false reopens it. */
    resolved: z.boolean(),
  })
  .strict();

/**
 * Resolving is the coached rep's acknowledgement — or the author tidying up.
 * Nobody else's: a third manager marking someone's coaching as handled is how
 * feedback disappears without being read.
 */
export const PATCH = route(
  { module: 'calls', productModule: 'SALES', action: 'EDIT', params, body: patchBody, auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) => {
    const call = await assertCallVisible(ctx, params.id);
    const note = await prisma.coachingNote.findFirst({
      where: { id: body.noteId, tenantId: ctx.tenantId, callId: params.id, deletedAt: null },
    });
    if (!note) throw NotFound('Coaching note');
    if (note.authorId !== ctx.actor.id && call.callerId !== ctx.actor.id) {
      throw Forbidden('Only the author or the coached rep can resolve a note.');
    }

    return prisma.coachingNote.update({
      where: { id: note.id, tenantId: ctx.tenantId },
      data: { resolvedAt: body.resolved ? new Date() : null },
    });
  },
);
