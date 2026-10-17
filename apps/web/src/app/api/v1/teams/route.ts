import { route } from '@/lib/api/handler';
import { prisma, withTx } from '@/lib/db';
import { setMembers, TEAM_FIELDS, teamBody, teamCode } from '@/services/people/teams';

/** Teams (audit M1-11): read with users:VIEW, created with users:MANAGE_USERS. */
export const GET = route({ module: 'users', action: 'VIEW' }, async ({ ctx }) => ({
  data: await prisma.team.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null },
    orderBy: { name: 'asc' },
    select: TEAM_FIELDS,
  }),
}));

export const POST = route(
  { module: 'users', action: 'MANAGE_USERS', body: teamBody, auditEvent: 'RECORD_CREATED' },
  async ({ ctx, body }) =>
    withTx(ctx.tenantId, async (tx) => {
      const team = await tx.team.create({
        data: {
          tenantId: ctx.tenantId,
          name: body.name,
          code: teamCode(body.name),
          managerId: body.managerId ?? null,
          createdById: ctx.actor.id,
          updatedById: ctx.actor.id,
        },
        select: { id: true },
      });
      await setMembers(tx, ctx.tenantId, team.id, body.memberIds ?? [], body.managerId ?? null);
      return tx.team.findFirstOrThrow({ where: { tenantId: ctx.tenantId, id: team.id }, select: TEAM_FIELDS });
    }),
);
