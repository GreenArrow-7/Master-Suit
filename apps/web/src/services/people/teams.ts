import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { TxClient } from '@/lib/db';
import { Invalid } from '@/lib/errors';

/**
 * Teams and their managers (audit M1-11, M18-14). TEAM scope already reads
 * `UserTeam` (lib/security/visibility.ts); this is the missing way to write it.
 * Membership changes take effect at each person's next sign-in, when their
 * session's team list is built.
 */
export const teamBody = z
  .object({
    name: z.string().min(2).max(120),
    managerId: z.string().min(1).nullable().optional(),
    memberIds: z.array(z.string().min(1)).max(500).optional(),
  })
  .strict();

export const TEAM_FIELDS = {
  id: true,
  name: true,
  managerId: true,
  members: { select: { userId: true, isManager: true } },
} as const;

export const teamCode = (name: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'team'
  }-${randomBytes(3).toString('hex')}`;

/** Replaces a team's members; the manager is a member, flagged as such. */
export async function setMembers(
  tx: TxClient,
  tenantId: string,
  teamId: string,
  memberIds: string[],
  managerId: string | null,
) {
  const ids = [...new Set([...memberIds, ...(managerId ? [managerId] : [])])];
  const found = await tx.user.count({ where: { tenantId, id: { in: ids }, deletedAt: null } });
  if (found !== ids.length)
    throw Invalid([
      { field: 'memberIds', code: 'unknown_member', message: 'Every member must be a person in this workspace.' },
    ]);
  await tx.userTeam.deleteMany({ where: { tenantId, teamId } });
  if (ids.length) {
    await tx.userTeam.createMany({
      data: ids.map((userId) => ({ tenantId, teamId, userId, isManager: userId === managerId })),
    });
  }
}
