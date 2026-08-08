import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const listQuery = z.object({
  unread: z.coerce.boolean().default(false),
});

export const GET = route({ module: 'leads', action: 'VIEW', query: listQuery }, async ({ ctx, query }) => {
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
});

const markBody = z.object({
  ids: z.array(z.string()).min(1).max(50),
});

export const PATCH = route({ module: 'leads', action: 'VIEW', body: markBody }, async ({ ctx, body }) => {
  await prisma.notification.updateMany({
    where: { tenantId: ctx.tenantId, userId: ctx.actor.id, id: { in: body.ids }, readAt: null },
    data: { readAt: new Date() },
  });
  const unreadCount = await prisma.notification.count({
    where: { tenantId: ctx.tenantId, userId: ctx.actor.id, readAt: null },
  });
  return { ok: true, unreadCount };
});
