import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { prisma } from '@/lib/db';

const body = z
  .object({
    targetId: z.string().cuid(),
    increment: z.number().int().positive().default(1),
  })
  .strict();

export const POST = route(
  { module: 'leads', productModule: 'SALES', action: 'EDIT', body },
  async ({ ctx, body: { targetId, increment } }) => {
    const dateKey = new Date().toISOString().slice(0, 10);

    const target = await prisma.employeeTarget.findFirst({
      where: { id: targetId, tenantId: ctx.tenantId, userId: ctx.actor.id },
    });
    if (!target) throw new Error('Target not found');

    // The tenant guard refuses any write without a tenantId filter; the compound
    // unique alone was tripping it, which left this endpoint returning 500 on
    // every call — no progress bar ever moved.
    return prisma.targetProgress.upsert({
      where: { tenantId: ctx.tenantId, targetId_dateKey: { targetId, dateKey } },
      create: { tenantId: ctx.tenantId, targetId, userId: ctx.actor.id, dateKey, achieved: increment },
      update: { achieved: { increment } },
    });
  },
);
