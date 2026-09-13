/**
 * Where a person demonstrably sat for a whole, finished period — or null where
 * the records cannot establish it.
 *
 * There is no placement history table. What the records do and do not say:
 *
 *   - `UserTeam.createdAt` is when the row was inserted (the database default;
 *     nothing in the application sets it). Membership may have begun earlier,
 *     never later, so a row created on or before `periodStart` proves the person
 *     was in that team when the period began.
 *   - Rows are never updated, and the application has no path that creates or
 *     deletes one: they come from the seed or from database administration, and
 *     a re-created row carries a new `createdAt`. So a row that still exists has
 *     existed continuously since it was created.
 *   - Deletions leave no trace. A second membership held during the period and
 *     removed since cannot be seen by anything here.
 *     ponytail: that is the ceiling of this rule; a membership history table is
 *     the upgrade, if memberships ever become editable in the application.
 *
 * So a team is given only when the period is over and exactly one membership
 * row was created before it ended — and that row was created on or before the
 * period began. A membership added during the period (a transfer, a second
 * team), one added afterwards (a backdated run), several at once, or a period
 * still running all give null.
 *
 * Branch and region are plain columns on `User`, trusted only if the user row
 * has not been written since `periodStart` (any write bumps `updatedAt`, and no
 * raw SQL writes the table).
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

const DAY = 86_400_000;
const UNKNOWN: Placement = { teamId: null, branchId: null, regionId: null };

/** `periodEnd` is the period's last day, as payroll runs store it; the period is over when that day is. */
export async function historicalPlacement(
  tenantId: string,
  userIds: string[],
  periodStart: Date,
  periodEnd: Date,
  now = new Date(),
): Promise<Map<string, Placement>> {
  const ended = new Date(periodEnd.getTime() + DAY);
  if (userIds.length === 0 || now < ended) return new Map(userIds.map((id) => [id, UNKNOWN]));
  const [memberships, users] = await Promise.all([
    prisma.userTeam.findMany({
      where: { tenantId, userId: { in: userIds }, createdAt: { lt: ended } },
      select: { userId: true, teamId: true, createdAt: true },
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
      teamId: teams.length === 1 && teams[0].createdAt <= periodStart ? teams[0].teamId : null,
      branchId: unchanged ? u.branchId : null,
      regionId: unchanged ? u.regionId : null,
    });
  }
  return out;
}
