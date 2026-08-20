import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { Forbidden } from '@/lib/errors';
import type { Ctx } from '@/lib/security/rbac';

/**
 * A notification feed belongs to a person, not to a machine.
 *
 * `selfService` below waives the permission check — that is what lets an
 * HR-only employee read their own notifications without a Sales grant. But an
 * API key authenticates through the same kernel and inherits
 * `actor.id = key.createdById`, so without this it would reach the creator's
 * feed as the creator, whatever its scopes were narrowed to, and could mark
 * their alerts read. The kernel does not enforce this for every self-service
 * route (identity/self and hr/self predate the decision and are unchanged);
 * this route asks for it.
 */
function requireSession(ctx: Ctx) {
  if (ctx.apiKeyId) throw Forbidden('This endpoint requires a signed-in session.');
}

const listQuery = z.object({
  // z.coerce.boolean() treated any non-empty string — "false" included — as true.
  unread: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

// Self-service, not leads:VIEW: notifications are the viewer's own rows (every
// query below filters on ctx.actor.id), and the leads gate 403'd HR-only users
// out of their own badge. Mirrors the SELF_SERVICE the /notifications page uses.
export const GET = route({ module: 'notifications', action: 'VIEW', selfService: true, query: listQuery }, async ({ ctx, query }) => {
  requireSession(ctx);
  const unreadWhere = { tenantId: ctx.tenantId, userId: ctx.actor.id, readAt: null };

  // The badge only wants the number; the 30 rows it used to get were discarded.
  if (query.unread) return { unreadCount: await prisma.notification.count({ where: unreadWhere }) };

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { tenantId: ctx.tenantId, userId: ctx.actor.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.notification.count({ where: unreadWhere }),
  ]);

  return { data: rows, unreadCount };
});

const markBody = z.object({
  ids: z.array(z.string()).min(1).max(50),
});

export const PATCH = route({ module: 'notifications', action: 'VIEW', selfService: true, body: markBody }, async ({ ctx, body }) => {
  requireSession(ctx);
  await prisma.notification.updateMany({
    where: { tenantId: ctx.tenantId, userId: ctx.actor.id, id: { in: body.ids }, readAt: null },
    data: { readAt: new Date() },
  });
  const unreadCount = await prisma.notification.count({
    where: { tenantId: ctx.tenantId, userId: ctx.actor.id, readAt: null },
  });
  return { ok: true, unreadCount };
});
