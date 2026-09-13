/**
 * Where a person demonstrably sat for a whole period — or null where the
 * records cannot establish it.
 *
 * There is no placement history table, so this uses only what cannot be
 * rewritten after the fact:
 *
 *   - Team: `UserTeam` rows are created and deleted, never updated. A row that
 *     still exists and was created on or before `periodStart` proves the person
 *     was in that team for the whole period. Exactly one such row gives the
 *     team; none (joined later — a backdated run, a mid-period transfer) or
 *     several (ambiguous) give null.
 *   - Branch and region are plain columns on `User`. They are trusted only if
 *     the user row has not been written since `periodStart`; any later write
 *     could have been a transfer, so the answer is null.
 *
 * Null is reported as an "Unknown historical" bucket. Nothing is guessed from
 * where the person sits today.
 */
import { prisma } from '@/lib/db';

export interface Placement {
  teamId: string | null;
  branchId: string | null;
  regionId: string | null;
}

export async function historicalPlacement(
  tenantId: string,
  userIds: string[],
  periodStart: Date,
): Promise<Map<string, Placement>> {
  if (userIds.length === 0) return new Map();
  const [memberships, users] = await Promise.all([
    prisma.userTeam.findMany({
      where: { tenantId, userId: { in: userIds }, createdAt: { lte: periodStart } },
      select: { userId: true, teamId: true },
    }),
    prisma.user.findMany({
      where: { tenantId, id: { in: userIds } },
      select: { id: true, branchId: true, regionId: true, updatedAt: true },
    }),
  ]);
  const out = new Map<string, Placement>();
  for (const u of users) {
    const teams = memberships.filter((m) => m.userId === u.id);
    const unchanged = u.updatedAt <= periodStart;
    out.set(u.id, {
      teamId: teams.length === 1 ? teams[0].teamId : null,
      branchId: unchanged ? u.branchId : null,
      regionId: unchanged ? u.regionId : null,
    });
  }
  return out;
}
