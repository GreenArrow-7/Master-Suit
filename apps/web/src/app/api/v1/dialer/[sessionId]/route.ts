import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Forbidden, NotFound } from '@/lib/errors';
import { can } from '@/lib/security/rbac';
import { advance, attachCall, endSession, endSessionAsLeader, sessionView } from '@/services/dialer/session';

const params = z.object({ sessionId: z.string().cuid() });

/**
 * Where the agent is.
 *
 * The only read the dialer screen needs, and the reason a refresh costs
 * nothing: the position is a column, so this returns the same contact, the same
 * counts and the same call it returned a second ago.
 */
export const GET = route(
  { module: 'dialer', productModule: 'SALES', action: 'VIEW', params },
  async ({ ctx, params }) => {
    const session = await prisma.dialerSession.findFirst({
      where: { id: params.sessionId, tenantId: ctx.tenantId },
      select: { userId: true },
    });
    if (!session) throw NotFound('Dialer session');
    // A leader watching the floor may read a session; only its owner advances it.
    if (session.userId !== ctx.actor.id && !can(ctx, 'dialer', 'MANAGE_USERS')) throw Forbidden();

    return sessionView(ctx.tenantId, params.sessionId);
  },
);

const patchBody = z
  .discriminatedUnion('action', [
    z.object({
      /** Finish the contact and take the next. */
      action: z.literal('next'),
      outcome: z
        .enum([
          'CONNECTED',
          'NO_ANSWER',
          'BUSY',
          'VOICEMAIL',
          'WRONG_NUMBER',
          'CALLBACK_REQUESTED',
          'NOT_INTERESTED',
          'INTERESTED',
          'QUALIFIED',
          'CONVERTED',
        ])
        .optional(),
      notes: z.string().max(2000).optional(),
    }),
    z.object({
      /** Pass without burning an attempt. */
      action: z.literal('skip'),
      notes: z.string().max(2000).optional(),
    }),
    z.object({
      action: z.literal('callback'),
      /** When the client asked to be rung. Defaults to an hour out. */
      callbackAt: z.coerce.date().optional(),
      notes: z.string().max(2000).optional(),
    }),
    z.object({
      /** Records the call just placed against the contact in front of the agent. */
      action: z.literal('attachCall'),
      callId: z.string().cuid(),
    }),
  ])
  .and(z.object({}).strict().partial());

/**
 * One endpoint for every way a contact ends.
 *
 * The sequence is identical whichever it is — settle the current row, release
 * its claim, claim the next — and only the disposition differs. Three endpoints
 * would be three copies of that dance, and the third copy is where the release
 * gets forgotten and a contact is stranded IN_PROGRESS forever.
 */
export const PATCH = route(
  {
    module: 'dialer',
    productModule: 'SALES',
    action: 'VIEW',
    params,
    body: patchBody,
    auditEvent: 'RECORD_UPDATED',
  },
  async ({ ctx, params, body }) => {
    if (body.action === 'attachCall') {
      return attachCall(ctx.tenantId, params.sessionId, body.callId, ctx.actor.id);
    }

    return advance({
      tenantId: ctx.tenantId,
      userId: ctx.actor.id,
      sessionId: params.sessionId,
      action: body.action,
      outcome: body.action === 'next' ? body.outcome : undefined,
      callbackAt: body.action === 'callback' ? body.callbackAt : undefined,
      notes: body.notes,
    });
  },
);

/**
 * End the shift.
 *
 * Releases the claim first, so whoever was on the screen goes back to the front
 * of the queue immediately rather than waiting fifteen minutes for the stale
 * sweep. A leader may end somebody else's session — that is the whole point of
 * a team dialer, and it takes a different function so the ownership check
 * cannot be skipped by passing an optional argument.
 */
export const DELETE = route(
  { module: 'dialer', productModule: 'SALES', action: 'VIEW', params, auditEvent: 'CALL_COMPLETED' },
  async ({ ctx, params }) => {
    const session = await prisma.dialerSession.findFirst({
      where: { id: params.sessionId, tenantId: ctx.tenantId },
      select: { userId: true },
    });
    if (!session) throw NotFound('Dialer session');

    if (session.userId === ctx.actor.id) {
      await endSession(ctx.tenantId, params.sessionId, ctx.actor.id);
    } else {
      if (!can(ctx, 'dialer', 'MANAGE_USERS')) throw Forbidden();
      await endSessionAsLeader(ctx.tenantId, params.sessionId);
    }

    return { id: params.sessionId, status: 'ENDED' };
  },
);
