import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const listQuery = z.object({
  unread: z.coerce.boolean().default(false),
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
    const where = {
      tenantId: ctx.tenantId,
      userId: ctx.actor.id,
      ...(query.unread ? { readAt: null } : {}),
    };

    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      prisma.notification.count({ where: { tenantId: ctx.tenantId, userId: ctx.actor.id, readAt: null } }),
    ]);

    return { data: rows, unreadCount };
  },
);

const markBody = z.object({
  ids: z.array(z.string()).min(1).max(50),
});

export const PATCH = route(
  { module: 'notifications', action: 'EDIT', selfService: true, body: markBody },
  async ({ ctx, body }) => {
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
