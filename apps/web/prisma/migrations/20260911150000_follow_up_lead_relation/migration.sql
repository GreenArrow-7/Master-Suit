-- Derivation of Lead.nextFollowUpAt reads the union of Task and FollowUpTask.
--
-- `FollowUpTask.leadId` has carried no foreign key since it was introduced, so
-- two things were true: Prisma could not express a relation filter on it (the
-- read path needs one), and deleting a Lead left its follow-ups behind pointing
-- at an id that no longer resolved. `Task.leadId` has always cascaded. This
-- makes the two stores agree.
--
-- Orphans are detached rather than deleted. A follow-up whose lead is gone is
-- already unreachable from that lead, but it is still a real obligation sitting
-- in somebody's personal queue, and dropping the row to satisfy a constraint
-- would delete work nobody asked to delete. Setting leadId NULL keeps the row
-- where its owner can still see it and makes the constraint valid.
DO $$
DECLARE orphaned INT;
BEGIN
  UPDATE "FollowUpTask" f
     SET "leadId" = NULL
   WHERE f."leadId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "Lead" l WHERE l."id" = f."leadId");
  GET DIAGNOSTICS orphaned = ROW_COUNT;
  IF orphaned > 0 THEN
    RAISE NOTICE 'detached % follow-up task(s) whose lead no longer exists', orphaned;
  END IF;
END $$;

-- NOT VALID, and validated by the next migration.
--
-- A plain ADD CONSTRAINT ... FOREIGN KEY scans every row of "FollowUpTask" while
-- holding SHARE ROW EXCLUSIVE on *both* tables. That blocks INSERT, UPDATE and
-- DELETE on "Lead" — the busiest table in the product — for as long as the scan
-- takes. On the validation database that is milliseconds; on a customer's it is
-- a write outage of unknown length, which is not a thing to discover during a
-- handover.
--
-- NOT VALID takes the same lock but does no scan, so it is brief and bounded.
-- The scan then happens in 20260911150500, in its own transaction, under
-- SHARE UPDATE EXCLUSIVE — which does not block writes. They are two files
-- because `prisma migrate deploy` wraps each file in one transaction, and locks
-- taken in a transaction are held until it commits: putting both statements
-- here would hold the first lock across the second's scan and buy nothing.
ALTER TABLE "FollowUpTask"
  ADD CONSTRAINT "FollowUpTask_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;

-- The derivation's per-lead union scan, on both stores.
CREATE INDEX IF NOT EXISTS "FollowUpTask_tenantId_leadId_status_dueAt_idx"
  ON "FollowUpTask" ("tenantId", "leadId", "status", "dueAt");
CREATE INDEX IF NOT EXISTS "Task_tenantId_leadId_status_dueAt_idx"
  ON "Task" ("tenantId", "leadId", "status", "dueAt");
