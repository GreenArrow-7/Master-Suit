import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

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
  await prisma.notification.updateMany({
    where: { tenantId: ctx.tenantId, userId: ctx.actor.id, id: { in: body.ids }, readAt: null },
    data: { readAt: new Date() },
  });
  const unreadCount = await prisma.notification.count({
    where: { tenantId: ctx.tenantId, userId: ctx.actor.id, readAt: null },
  });
  return { ok: true, unreadCount };
});
