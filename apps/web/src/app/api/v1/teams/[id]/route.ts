import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { withTx } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { setMembers, TEAM_FIELDS, teamBody } from '@/services/people/teams';

const params = z.object({ id: z.string().cuid() });

export const PATCH = route(
  { module: 'users', action: 'MANAGE_USERS', params, body: teamBody.partial(), auditEvent: 'RECORD_UPDATED' },
  async ({ ctx, params, body }) =>
    withTx(ctx.tenantId, async (tx) => {
      const team = await tx.team.findFirst({
        where: { tenantId: ctx.tenantId, id: params.id, deletedAt: null },
        select: { id: true, managerId: true, members: { select: { userId: true } } },
      });
      if (!team) throw NotFound('Team');
      const managerId = body.managerId === undefined ? team.managerId : body.managerId;
      await tx.team.updateMany({
        where: { tenantId: ctx.tenantId, id: team.id },
        data: { ...(body.name ? { name: body.name } : {}), managerId, updatedById: ctx.actor.id },
      });
      if (body.memberIds !== undefined || body.managerId !== undefined) {
        const memberIds = body.memberIds ?? team.members.map((m) => m.userId);
        await setMembers(tx, ctx.tenantId, team.id, memberIds, managerId);
      }
      return tx.team.findFirstOrThrow({ where: { tenantId: ctx.tenantId, id: team.id }, select: TEAM_FIELDS });
    }),
);

export const DELETE = route(
  { module: 'users', action: 'MANAGE_USERS', params, auditEvent: 'RECORD_DELETED' },
  async ({ ctx, params }) =>
    withTx(ctx.tenantId, async (tx) => {
      const team = await tx.team.findFirst({ where: { tenantId: ctx.tenantId, id: params.id, deletedAt: null } });
      if (!team) throw NotFound('Team');
      await tx.userTeam.deleteMany({ where: { tenantId: ctx.tenantId, teamId: team.id } });
      await tx.team.updateMany({
        where: { tenantId: ctx.tenantId, id: team.id },
        data: { deletedAt: new Date(), updatedById: ctx.actor.id },
      });
      return { deleted: true };
    }),
);
