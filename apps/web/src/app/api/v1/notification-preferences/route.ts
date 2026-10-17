import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';
import { readPrefs } from '@/lib/notificationPrefs';

const body = z.object({ push: z.boolean(), email: z.boolean(), digest: z.boolean().default(false) }).strict();

/** Your own delivery choices; not a privilege, so `selfService` like device registration. */
export const GET = route({ module: 'notifications', action: 'VIEW', selfService: true }, async ({ ctx }) => {
  const user = await prisma.user.findFirst({
    where: { tenantId: ctx.tenantId, id: ctx.actor.id },
    select: { notificationPrefs: true },
  });
  return readPrefs(user?.notificationPrefs);
});

export const PUT = route(
  { module: 'notifications', action: 'EDIT', selfService: true, body },
  async ({ ctx, body }) => {
    await prisma.user.updateMany({
      where: { tenantId: ctx.tenantId, id: ctx.actor.id },
      data: { notificationPrefs: body },
    });
    return readPrefs(body);
  },
);
