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

/**
 * Your own notifications.
 *
 * `selfService`, not `leads:VIEW`. Gating this on a Sales permission meant a
 * People-only workspace — or any HR role without `leads:VIEW` — could not read
 * the notifications `services/hr/notify.ts` was writing for it: eighteen HR
 * events, an in-app row for each, and no way to see them. The kernel's own
 * docstring gives the rule this now follows: self-service is not a privilege,
 * and a route that reads nothing but `ctx.actor.id` takes no target parameter to
 * authorize against.
 *
 * `module` stays declared, because the kernel still keys audit and rate limits
 * on it.
 */
export const GET = route(
  { module: 'notifications', action: 'VIEW', selfService: true, query: listQuery },
  async ({ ctx, query }) => {
    requireSession(ctx);
    const unreadWhere = { tenantId: ctx.tenantId, userId: ctx.actor.id, readAt: null };

    // The badge only wants the number; the 30 rows it used to get were discarded
    // on every navigation.
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
  },
);

const markBody = z.object({
  ids: z.array(z.string()).min(1).max(50),
});

export const PATCH = route(
  // `EDIT`, not `VIEW`: marking a notification read is a write, and although
  // `selfService` waives the permission check either way, this is the action the
  // audit row and the rate-limit key record.
  { module: 'notifications', action: 'EDIT', selfService: true, body: markBody },
  async ({ ctx, body }) => {
    requireSession(ctx);
    await prisma.notification.updateMany({
      where: { tenantId: ctx.tenantId, userId: ctx.actor.id, id: { in: body.ids }, readAt: null },
      data: { readAt: new Date() },
    });
    const unreadCount = await prisma.notification.count({
      where: { tenantId: ctx.tenantId, userId: ctx.actor.id, readAt: null },
    });
    return { ok: true, unreadCount };
  },
);
