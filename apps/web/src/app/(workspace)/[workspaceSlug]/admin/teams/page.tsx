import { prisma } from '@/lib/db';
import { can } from '@/lib/security/rbac';
import { requirePageAccess } from '@/lib/workspace-page';
import ListHeader from '@/components/workspace/ListHeader';
import TeamsPanel from './TeamsPanel';

export const metadata = { title: 'Teams' };

/**
 * Teams and their managers (audit M1-11). A role at TEAM scope sees its team's
 * work; a manager of a team also sees the teams below it.
 */
export default async function TeamsPage() {
  const ctx = await requirePageAccess({ permission: ['users', 'VIEW'] });
  const [teams, people] = await Promise.all([
    prisma.team.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, managerId: true, members: { select: { userId: true } } },
    }),
    prisma.user.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, status: 'ACTIVE' },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true },
    }),
  ]);
  return (
    <>
      <ListHeader
        title="Teams"
        description="Group people under a manager. Roles with team scope see their team's leads, follow-ups and calls."
      />
      <TeamsPanel
        canManage={can(ctx, 'users', 'MANAGE_USERS')}
        people={people}
        teams={teams.map((team) => ({
          id: team.id,
          name: team.name,
          managerId: team.managerId,
          memberIds: team.members.map((member) => member.userId),
        }))}
      />
    </>
  );
}
