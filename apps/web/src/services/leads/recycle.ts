import { withPlatformTx } from '@/lib/db';
import { logger } from '@/lib/logger';
import { OPEN_LEADS_WHERE } from './closeOut';

/**
 * Returning leads nobody is working to the pool.
 *
 * A lead assigned months ago and never touched is worse than an unassigned one:
 * it looks accounted for. It sits in somebody's list, counts towards their
 * capacity, and is invisible to the allocator, which only ever looks at leads
 * with no owner. This sweep clears the owner so the existing allocation path
 * can hand it to somebody who will ring it.
 *
 * ── Off unless a workspace asks for it ──────────────────────────────────────
 *
 * `OrganizationSetting.leadRecycleAfterDays` is null by default and null means
 * the sweep skips that workspace entirely. This is the whole safety design:
 * clearing ownership is a write against somebody's book of work, and a feature
 * that switched itself on for every existing workspace at deploy time would
 * move customer data nobody asked it to move. Opting in is a number an
 * administrator sets.
 *
 * ── What "unworked" means, and what it deliberately excludes ────────────────
 *
 * Only leads still in an OPEN stage that are not closed out. Nothing that
 * reached an outcome is reopened: a lost lead stays lost, a converted one stays
 * converted, and an INVALID/DUPLICATE/ARCHIVED one stays closed. Recycling a
 * terminal record would change what "closed" means to everyone reading it, and
 * that is a product decision this sweep does not get to make on its own.
 *
 * Dormancy is `lastActivityAt` older than the workspace's threshold, and for
 * the many rows where that column was never written, `createdAt` instead. That
 * pair is not invented here — it is the same predicate the assistant's
 * `no_activity_30d` filter uses, and using a second definition of "dormant"
 * would let two screens disagree about the same lead.
 *
 * A lead with a follow-up booked in the future is never recycled, whatever its
 * `lastActivityAt` says. Somebody has a plan for it; taking it off them because
 * the plan is for next week is the sweep being wrong in the most annoying
 * possible way.
 *
 * ── Idempotent by construction ──────────────────────────────────────────────
 *
 * A candidate must have an owner, and the sweep's only write removes it. A
 * second pass — a retry, an overlapping run, a changed schedule — finds nothing
 * to do, with no claim flag or `recycledAt` column to keep correct.
 */

/** The product default, used when a workspace opted in without naming a number. */
const DEFAULT_AFTER_DAYS = 30;

/** A ceiling per workspace per pass, so one enormous backlog cannot own the queue. */
const PER_WORKSPACE_LIMIT = 200;

const DAY_MS = 86_400_000;

export interface RecycleSweepResult {
  /** Workspaces that had opted in and were examined. */
  workspaces: number;
  /** Leads returned to the pool. */
  recycled: number;
}

export async function runRecycleSweep(now = new Date()): Promise<RecycleSweepResult> {
  /**
   * The one query here that spans tenants, and raw for exactly that reason.
   *
   * The tenant guard refuses an unscoped `findMany`, correctly: a repository
   * that reads across workspaces through the ordinary client is relying on RLS
   * alone. Enumerating which workspaces opted in is genuinely cross-tenant —
   * there is no tenant to name yet — so it goes through the raw path the guard
   * allows, inside `withPlatformTx`, the same way the reminder and retention
   * sweeps do.
   *
   * Everything after this names its tenant explicitly and goes through the
   * guarded client, so the sweep reads one workspace at a time from here on.
   */
  const settings = await withPlatformTx(
    (tx) =>
      tx.$queryRaw<{ tenantId: string; leadRecycleAfterDays: number | null }[]>`
      SELECT "tenantId", "leadRecycleAfterDays"
        FROM "OrganizationSetting"
       WHERE "leadRecycleAfterDays" IS NOT NULL`,
  );

  let recycled = 0;
  let workspaces = 0;

  for (const setting of settings) {
    const days = setting.leadRecycleAfterDays ?? DEFAULT_AFTER_DAYS;
    // A zero or negative threshold would recycle everything the moment it was
    // saved. Treated as "not configured" rather than obeyed.
    if (days <= 0) continue;
    workspaces += 1;

    try {
      recycled += await recycleWorkspace(setting.tenantId, days, now);
    } catch (err) {
      // One workspace's failure must not stop the rest being swept. The sweep
      // is idempotent, so the next pass picks up whatever this one missed.
      logger.error({ err, tenantId: setting.tenantId }, 'lead recycle failed for workspace');
    }
  }

  return { workspaces, recycled };
}

async function recycleWorkspace(tenantId: string, days: number, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - days * DAY_MS);

  return withPlatformTx(async (tx) => {
    const candidates = await tx.lead.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ownerId: { not: null },
        stage: { is: { category: 'OPEN' } },
        /**
         * Two independent OR groups, combined with AND — and emphatically not
         * spread into this object.
         *
         * `OPEN_LEADS_WHERE` is itself `{ OR: [...] }`, so spreading it beside
         * a second `OR` key silently dropped it: the later key won, the
         * close-out filter vanished, and the sweep cheerfully reopened archived
         * leads. The test for closed-out records is what caught it.
         */
        AND: [
          // Not closed out: INVALID, DUPLICATE and ARCHIVED keep their meaning.
          OPEN_LEADS_WHERE,
          {
            // Dormant, and with nobody already planning the next touch.
            OR: [
              { nextFollowUpAt: null, lastActivityAt: { lt: cutoff } },
              { nextFollowUpAt: null, lastActivityAt: null, createdAt: { lt: cutoff } },
              { nextFollowUpAt: { lt: now }, lastActivityAt: { lt: cutoff } },
              { nextFollowUpAt: { lt: now }, lastActivityAt: null, createdAt: { lt: cutoff } },
            ],
          },
        ],
      },
      select: { id: true, ownerId: true, fullName: true, reference: true },
      take: PER_WORKSPACE_LIMIT,
    });
    if (!candidates.length) return 0;

    const ids = candidates.map((lead) => lead.id);

    /**
     * Re-checked in the same statement that clears it.
     *
     * `ownerId: { not: null }` is repeated here rather than trusted from the
     * read above: between the two, somebody may have reassigned or worked the
     * lead. The conditional update means a concurrent writer wins and this
     * sweep simply does less, which is the right way round — the cost of
     * skipping a lead is one more sweep, and the cost of clobbering a fresh
     * assignment is an agent losing work they were just given.
     */
    const { count } = await tx.lead.updateMany({
      where: { id: { in: ids }, tenantId, ownerId: { not: null } },
      data: { ownerId: null },
    });
    if (!count) return 0;

    await tx.leadAssignmentHistory.createMany({
      data: candidates.map((lead) => ({
        tenantId,
        leadId: lead.id,
        fromOwnerId: lead.ownerId,
        toOwnerId: null,
        reason: `Recycled to the pool after ${days} days without activity`,
      })),
    });

    /**
     * The previous owner is told, because a record vanishing from your list
     * with no explanation is the complaint this would otherwise generate. Kept
     * out of `PUSHED` in services/crm/notify.ts deliberately: losing a lead
     * nobody worked is not worth ringing a phone over.
     */
    await tx.notification.createMany({
      data: candidates
        .filter((lead) => lead.ownerId)
        .map((lead) => ({
          tenantId,
          userId: lead.ownerId!,
          kind: 'lead.recycled',
          title: `${lead.fullName} returned to the pool`,
          body: `${lead.reference} had no activity for ${days} days`,
          objectType: 'lead',
          recordId: lead.id,
          priority: 'LOW' as const,
          channels: ['in_app'],
        })),
    });

    return count;
  });
}
