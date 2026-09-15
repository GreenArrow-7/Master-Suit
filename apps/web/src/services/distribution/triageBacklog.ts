/**
 * The leads that were already unassigned when the queue was built.
 *
 * P1-1 made a lead that *fails* assignment accountable. It did nothing for the
 * ones already sitting unowned — those enter the queue only if something happens
 * to process them again, which for an old lead may be never. So the business
 * that existed before the queue stayed outside it, which is most of the business.
 *
 * ── What is deliberately not recorded ───────────────────────────────────────
 *
 * **No invented history.** Nothing anywhere says why these leads were never
 * placed, or when they started waiting. So the entry carries:
 *
 *   - `reason = PRE_EXISTING` — its own value, not a guess at one of the four
 *     real failure reasons;
 *   - `openedAt` = when reconciliation *found* it, which every surface must
 *     label as discovery rather than as a waiting time;
 *   - `historyUnknown = true` — the flag those surfaces read;
 *   - `detail.assessedAt` and `detail.candidates` — the eligibility picture **as
 *     it is now**, which is a present-tense fact and honest to record.
 *
 * A lead unassigned for eight months and discovered this morning must not show
 * "3 min". That is worse than showing nothing, because it looks precise.
 *
 * ── Which leads ─────────────────────────────────────────────────────────────
 *
 * Eligibility uses the lifecycle rules that already exist rather than new ones:
 * `ownerId IS NULL`, `deletedAt IS NULL`, and a stage whose `category` is
 * `OPEN`. `LeadStage.category` is the repository's existing notion of a live
 * lead — `poolDepth` and `claimForUser` in allocation.ts both use it, so a lead
 * this includes is exactly a lead bulk allocation would hand out. Won, lost and
 * otherwise closed stages are excluded by that same rule, as are soft-deleted
 * leads and any lead that already has an open episode.
 */
import { Prisma } from '@prisma/client';
import { prisma, withPlatformTx, withTx } from '@/lib/db';
import { logger } from '@/lib/logger';
import { assessEligibility, policyFromRule, redactForSales, DEFAULT_POLICY } from './eligibility';
import { openTriageEntry } from './triage';

export interface BacklogCount {
  tenantId: string;
  /** Unowned, live, not already queued — what reconciliation would import. */
  eligible: number;
  /** Unowned and live but already has an open episode. */
  alreadyQueued: number;
  /** Unowned but in a closed stage: won, lost, or otherwise finished. */
  closedStage: number;
  /** Unowned and soft-deleted. */
  deleted: number;
}

/**
 * The read-only count, grouped by tenant and by why a lead is or is not in
 * scope. Writes nothing.
 */
export async function countBacklog(tenantId?: string): Promise<BacklogCount[]> {
  const rows = await withPlatformTx(
    (tx) =>
      tx.$queryRaw<
        { tenantId: string; eligible: bigint; alreadyQueued: bigint; closedStage: bigint; deleted: bigint }[]
      >`
      SELECT l."tenantId",
             COUNT(*) FILTER (
               WHERE l."deletedAt" IS NULL AND s."category" = 'OPEN' AND q."id" IS NULL
             ) AS "eligible",
             COUNT(*) FILTER (
               WHERE l."deletedAt" IS NULL AND s."category" = 'OPEN' AND q."id" IS NOT NULL
             ) AS "alreadyQueued",
             COUNT(*) FILTER (
               WHERE l."deletedAt" IS NULL AND s."category" <> 'OPEN'
             ) AS "closedStage",
             COUNT(*) FILTER (WHERE l."deletedAt" IS NOT NULL) AS "deleted"
        FROM "Lead" l
        JOIN "LeadStage" s ON s."id" = l."stageId"
        LEFT JOIN "LeadTriageEntry" q
               ON q."leadId" = l."id" AND q."tenantId" = l."tenantId" AND q."status" = 'WAITING'
       WHERE l."ownerId" IS NULL
         ${tenantId ? Prisma.sql`AND l."tenantId" = ${tenantId}` : Prisma.empty}
       GROUP BY l."tenantId"
       ORDER BY l."tenantId"
    `,
  );
  return rows.map((r) => ({
    tenantId: r.tenantId,
    eligible: Number(r.eligible),
    alreadyQueued: Number(r.alreadyQueued),
    closedStage: Number(r.closedStage),
    deleted: Number(r.deleted),
  }));
}

export interface ImportResult {
  tenantId: string;
  /** How many were in scope when the run started. */
  considered: number;
  /** New episodes opened. */
  imported: number;
  /**
   * In scope at the start and not imported: something changed underneath — the
   * lead was assigned, deleted, moved to a closed stage, or queued by another
   * run. Explained rather than left as a discrepancy in the numbers.
   */
  skipped: number;
  /** Reasons, so the count above is not a mystery. */
  skippedBy: Record<string, number>;
}

/**
 * Import the eligible backlog for one workspace.
 *
 * Repeatable: the partial unique index on `(tenantId, leadId) WHERE status =
 * 'WAITING'` means a second run finds every lead already queued and opens
 * nothing. Each lead is its own transaction, so a failure part-way leaves the
 * ones already done rather than rolling back the whole run.
 */
export async function importBacklog(
  tenantId: string,
  opts: { apply: boolean; limit?: number; now?: Date } = { apply: false },
): Promise<ImportResult> {
  const now = opts.now ?? new Date();

  const candidates = await withTx(
    tenantId,
    (tx) =>
      tx.$queryRaw<{ id: string; teamId: string | null }[]>`
      SELECT l."id", l."teamId"
        FROM "Lead" l
        JOIN "LeadStage" s ON s."id" = l."stageId"
        LEFT JOIN "LeadTriageEntry" q
               ON q."leadId" = l."id" AND q."tenantId" = l."tenantId" AND q."status" = 'WAITING'
       WHERE l."tenantId" = ${tenantId}
         AND l."ownerId" IS NULL
         AND l."deletedAt" IS NULL
         AND s."category" = 'OPEN'
         AND q."id" IS NULL
       ORDER BY l."createdAt"
       LIMIT ${opts.limit ?? 5_000}
    `,
  );

  const result: ImportResult = {
    tenantId,
    considered: candidates.length,
    imported: 0,
    skipped: 0,
    skippedBy: {},
  };
  if (!opts.apply || candidates.length === 0) return result;

  const rule = await prisma.distributionRule.findFirst({
    where: { tenantId, objectType: 'LEAD', isActive: true, method: 'ROUND_ROBIN', deletedAt: null },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      name: true,
      candidatePool: true,
      escalateAfterMins: true,
      fallbackTeamId: true,
      fallbackUserId: true,
      respectLeave: true,
      respectQuotas: true,
      respectCapacity: true,
    },
  });

  /**
   * The eligibility picture as it is *now*, assessed once for the run rather
   * than per lead: it is the same pool and the same answer for all of them, and
   * asking per lead would be thousands of identical queries.
   */
  const pool = (rule?.candidatePool as { userIds?: string[] })?.userIds ?? [];
  const verdicts = await assessEligibility(tenantId, pool, rule ? policyFromRule(rule) : DEFAULT_POLICY, now);
  const assessment = verdicts.map((v) => ({
    userId: v.userId,
    // Redacted before it is persisted, as everywhere else: this JSON is readable
    // by any Sales viewer with queue access.
    blockers: redactForSales(v.blockers, false),
  }));

  const note = (key: string) => {
    result.skipped += 1;
    result.skippedBy[key] = (result.skippedBy[key] ?? 0) + 1;
  };

  for (const lead of candidates) {
    try {
      const opened = await withTx(tenantId, async (tx) => {
        /**
         * Re-checked inside the transaction against the same lifecycle rule the
         * SELECT used. Between the scan and here the lead may have been
         * assigned, deleted or moved to a closed stage — and opening a WAITING
         * episode on a lead that now has an owner is precisely the state the
         * queue must never be in.
         */
        const live = await tx.$queryRaw<{ id: string }[]>`
          SELECT l."id" FROM "Lead" l
            JOIN "LeadStage" s ON s."id" = l."stageId"
           WHERE l."id" = ${lead.id} AND l."tenantId" = ${tenantId}
             AND l."ownerId" IS NULL AND l."deletedAt" IS NULL AND s."category" = 'OPEN'
           FOR UPDATE OF l
        `;
        if (live.length === 0) return { entryId: null, alreadyQueued: false, gone: true };

        const out = await openTriageEntry(tx, {
          tenantId,
          leadId: lead.id,
          reason: 'PRE_EXISTING',
          historyUnknown: true,
          detail: {
            ruleName: rule?.name,
            assessedAt: now.toISOString(),
            candidates: assessment,
          },
          rule,
          leadTeamId: lead.teamId,
          now,
        });
        return { ...out, gone: false };
      });

      if (opened.gone) note('changed_since_scan');
      else if (opened.alreadyQueued) note('already_queued');
      else result.imported += 1;
    } catch (err) {
      note('error');
      logger.warn({ err, tenantId, leadId: lead.id }, 'backlog reconciliation could not queue a lead');
    }
  }

  logger.info(result, 'triage backlog reconciliation');
  return result;
}
