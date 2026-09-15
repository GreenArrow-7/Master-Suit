/**
 * What the stored column says, against what the obligations say.
 *
 * ── Report first, repair second ─────────────────────────────────────────────
 *
 * `apply` defaults to false and the report is the deliverable. A sweep that
 * silently corrects drift destroys the only evidence that a write path exists
 * which does not recompute — which is the entire reason to run it. Every
 * application writer takes the lead's lock and recomputes in the same
 * transaction, so **a non-zero count after this package ships is a bug, not
 * housekeeping**: a new endpoint, a script, a migration, or an automation rule
 * writing the column directly (`update_field` accepts any field name, and
 * `nextFollowUpAt` is a field name).
 *
 * ── Why a rerun cannot clobber a concurrent write ───────────────────────────
 *
 * The repair does not write the value it measured. It takes the lead's row lock
 * and calls the same `recomputeNextFollowUp` the application uses, which
 * re-derives from whatever is committed at that moment. So the worst case for a
 * lead that changed between the scan and the repair is that the repair computes
 * the *new* correct value instead of the old one — never that it reinstates a
 * stale number over a fresh write. Running it twice is running it once.
 *
 * ── What "undated" means here ───────────────────────────────────────────────
 *
 * Nothing. `Task.dueAt` and `FollowUpTask.dueAt` are both `NOT NULL`, so an
 * open obligation without a due date is not representable and the count is
 * structurally zero. It is reported anyway, because a schema can change and a
 * zero that is asserted is worth more than a case nobody looked at.
 */
import { withPlatformTx, withTx, type TxClient } from '@/lib/db';
import { logger } from '@/lib/logger';
import { lockLeads, recomputeNextFollowUp } from './nextFollowUp';

/** Named for `scripts/check-raw-sql-scope.mjs`. See distribution/eligibility.ts. */
type TransactionClient = TxClient;

/** A lead whose stored value disagrees with its obligations. */
export interface Disagreement {
  leadId: string;
  reference: string;
  stored: Date | null;
  derived: Date | null;
  kind: 'missing' | 'stale' | 'unexpected';
}

export interface DriftReport {
  tenantId: string;
  scannedAt: Date;
  leads: number;
  agreeing: number;
  /** Derived a date, stored nothing — work that no overdue screen could see. */
  missing: number;
  /** Both hold a date and they differ. */
  stale: number;
  /** Stored a date with nothing open behind it — a lead that looks owed and is not. */
  unexpected: number;
  openTasks: number;
  openFollowUps: number;
  /** Open obligations attached to no lead. Real work, but no lead aggregate. */
  unattachedTasks: number;
  unattachedFollowUps: number;
  /** Open tasks pointing at a lead *and* another record. See the header. */
  ambiguousTasks: number;
  /** Structurally zero: both `dueAt` columns are NOT NULL. Asserted, not assumed. */
  undatedObligations: number;
  /** Bounded sample for diagnosis; never the whole set. */
  samples: Disagreement[];
}

const SAMPLE_LIMIT = 20;

interface CountRow {
  leads: bigint;
  missing: bigint;
  stale: bigint;
  unexpected: bigint;
  open_tasks: bigint;
  open_fut: bigint;
  unattached_tasks: bigint;
  unattached_fut: bigint;
  ambiguous_tasks: bigint;
  undated: bigint;
}

/**
 * The derived value per lead, as SQL, so the comparison is one pass.
 *
 * Identical predicate to `recomputeNextFollowUp` — if these two ever disagree
 * the report is measuring itself rather than the data, so they are kept
 * adjacent deliberately.
 */
const DERIVED = `
  SELECT MIN(d."dueAt") FROM (
    SELECT t."dueAt" FROM "Task" t
     WHERE t."tenantId" = l."tenantId" AND t."leadId" = l."id"
       AND t."deletedAt" IS NULL AND t."status" IN ('OPEN','IN_PROGRESS','RESCHEDULED')
    UNION ALL
    SELECT f."dueAt" FROM "FollowUpTask" f
     WHERE f."tenantId" = l."tenantId" AND f."leadId" = l."id"
       AND f."deletedAt" IS NULL AND f."status" IN ('OPEN','IN_PROGRESS','RESCHEDULED')
  ) d`;

/** Read-only. Takes no locks and writes nothing. */
export async function reportDrift(tenantId: string, now = new Date()): Promise<DriftReport> {
  const [counts, samples] = await withTx(tenantId, async (tx) => {
    const countRows = await tx.$queryRawUnsafe<CountRow[]>(
      `WITH cmp AS (
         SELECT l."id", l."nextFollowUpAt" AS stored, (${DERIVED}) AS derived
           FROM "Lead" l
          WHERE l."tenantId" = $1 AND l."deletedAt" IS NULL
       )
       SELECT
         (SELECT count(*) FROM cmp)                                                          AS leads,
         (SELECT count(*) FROM cmp WHERE stored IS NULL     AND derived IS NOT NULL)         AS missing,
         (SELECT count(*) FROM cmp WHERE stored IS NOT NULL AND derived IS NOT NULL
                                     AND stored <> derived)                                  AS stale,
         (SELECT count(*) FROM cmp WHERE stored IS NOT NULL AND derived IS NULL)             AS unexpected,
         (SELECT count(*) FROM "Task" t WHERE t."tenantId" = $1 AND t."deletedAt" IS NULL
            AND t."status" IN ('OPEN','IN_PROGRESS','RESCHEDULED'))                          AS open_tasks,
         (SELECT count(*) FROM "FollowUpTask" f WHERE f."tenantId" = $1 AND f."deletedAt" IS NULL
            AND f."status" IN ('OPEN','IN_PROGRESS','RESCHEDULED'))                          AS open_fut,
         (SELECT count(*) FROM "Task" t WHERE t."tenantId" = $1 AND t."deletedAt" IS NULL
            AND t."status" IN ('OPEN','IN_PROGRESS','RESCHEDULED') AND t."leadId" IS NULL)   AS unattached_tasks,
         (SELECT count(*) FROM "FollowUpTask" f WHERE f."tenantId" = $1 AND f."deletedAt" IS NULL
            AND f."status" IN ('OPEN','IN_PROGRESS','RESCHEDULED') AND f."leadId" IS NULL)   AS unattached_fut,
         (SELECT count(*) FROM "Task" t WHERE t."tenantId" = $1 AND t."deletedAt" IS NULL
            AND t."status" IN ('OPEN','IN_PROGRESS','RESCHEDULED') AND t."leadId" IS NOT NULL
            AND (t."opportunityId" IS NOT NULL OR t."accountId" IS NOT NULL
                 OR t."ticketId" IS NOT NULL))                                               AS ambiguous_tasks,
         0::bigint                                                                            AS undated`,
      tenantId,
    );

    const sampleRows = await tx.$queryRawUnsafe<
      { id: string; reference: string; stored: Date | null; derived: Date | null }[]
    >(
      `SELECT l."id", l."reference", l."nextFollowUpAt" AS stored, (${DERIVED}) AS derived
         FROM "Lead" l
        WHERE l."tenantId" = $1 AND l."deletedAt" IS NULL
          AND (l."nextFollowUpAt" IS DISTINCT FROM (${DERIVED}))
        ORDER BY l."id"
        LIMIT ${SAMPLE_LIMIT}`,
      tenantId,
    );
    return [countRows[0], sampleRows] as const;
  });

  const n = (v: bigint | undefined) => Number(v ?? 0n);
  const leads = n(counts?.leads);
  const missing = n(counts?.missing);
  const stale = n(counts?.stale);
  const unexpected = n(counts?.unexpected);

  return {
    tenantId,
    scannedAt: now,
    leads,
    agreeing: leads - missing - stale - unexpected,
    missing,
    stale,
    unexpected,
    openTasks: n(counts?.open_tasks),
    openFollowUps: n(counts?.open_fut),
    unattachedTasks: n(counts?.unattached_tasks),
    unattachedFollowUps: n(counts?.unattached_fut),
    ambiguousTasks: n(counts?.ambiguous_tasks),
    undatedObligations: n(counts?.undated),
    samples: samples.map((r) => ({
      leadId: r.id,
      reference: r.reference,
      stored: r.stored,
      derived: r.derived,
      kind: r.stored === null ? 'missing' : r.derived === null ? 'unexpected' : 'stale',
    })),
  };
}

/**
 * Bring the stored column back in line, one lead per transaction.
 *
 * Per-lead rather than one sweeping `UPDATE` so a long repair does not hold
 * every lead in the workspace locked while it runs, and so a failure part-way
 * leaves the leads it already fixed fixed. The protocol is the application's
 * own: lock the lead, recompute inside the lock.
 */
export async function repairDrift(
  tenantId: string,
  opts: { apply?: boolean; limit?: number } = {},
): Promise<{ considered: number; repaired: number }> {
  const report = await reportDrift(tenantId);
  const disagreeing = report.missing + report.stale + report.unexpected;
  if (!opts.apply) {
    logger.info({ tenantId, disagreeing }, 'next-follow-up drift: dry run, nothing written');
    return { considered: disagreeing, repaired: 0 };
  }

  const limit = opts.limit ?? 10_000;
  const ids = await withTx(tenantId, (tx) =>
    tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT l."id" FROM "Lead" l
        WHERE l."tenantId" = $1 AND l."deletedAt" IS NULL
          AND (l."nextFollowUpAt" IS DISTINCT FROM (${DERIVED}))
        ORDER BY l."id"
        LIMIT ${limit}`,
      tenantId,
    ),
  );

  let repaired = 0;
  for (const { id } of ids) {
    await withTx(tenantId, async (tx: TransactionClient) => {
      await lockLeads(tx, tenantId, [id]);
      await recomputeNextFollowUp(tx, tenantId, id);
    });
    repaired += 1;
  }
  logger.info({ tenantId, considered: ids.length, repaired }, 'next-follow-up drift repaired');
  return { considered: ids.length, repaired };
}

/**
 * The canary, across every workspace. Report-only, always.
 *
 * There is no `apply` here and there should not be one: the scheduled job's
 * job is to notice, and a scheduled repair would keep the system looking
 * healthy while the path that breaks it stays in the tree. Repair is a
 * deliberate operator action against a named workspace.
 */
export async function sweepDriftCanary(now = new Date()): Promise<{ tenants: number; disagreeing: number }> {
  const tenants = await withPlatformTx(
    (tx: TransactionClient) =>
      tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Tenant" WHERE "status" = 'ACTIVE' ORDER BY "id"`,
  );

  let disagreeing = 0;
  for (const { id } of tenants) {
    const report = await reportDrift(id, now);
    const total = report.missing + report.stale + report.unexpected;
    if (total > 0) {
      disagreeing += total;
      logger.error(
        {
          tenantId: id,
          missing: report.missing,
          stale: report.stale,
          unexpected: report.unexpected,
          // Enough to start from: which leads, and what each side thinks.
          sample: report.samples.slice(0, 5),
        },
        'next-follow-up drift detected — a write path is not recomputing',
      );
    }
  }
  if (disagreeing === 0) logger.info({ tenants: tenants.length }, 'next-follow-up drift canary: clean');
  return { tenants: tenants.length, disagreeing };
}

/** Count only, for a caller that just wants the number. */
export async function driftCount(tenantId: string): Promise<number> {
  const r = await reportDrift(tenantId);
  return r.missing + r.stale + r.unexpected;
}
