-- The Lead Eagle board (audit rows M3-04 and M3-14). Additive: one column with a
-- default, and a backfill of a column that was never written.

-- What a follow-up is for. Every follow-up so far was booked as a call reminder
-- (the call log's "Follow-up call", the Follow-ups composer, a call's page), so
-- CALL is the default; a meeting or a site visit says so. The board's
-- "Callbacks" are the calls due today.
ALTER TABLE "FollowUpTask" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CALL';

-- `Lead.firstContactedAt` was never written, so every lead read as never
-- contacted. touchLead stamps it from now on; a lead worked before gets the
-- time of its earliest activity or call, as touchLead would have stamped it.
SELECT set_config('app.platform_admin', 'on', true);

UPDATE "Lead" l
SET "firstContactedAt" = w."firstAt"
FROM (
  SELECT t."leadId", min(t."at") AS "firstAt"
  FROM (
    SELECT "leadId", "occurredAt" AS "at" FROM "Activity" WHERE "leadId" IS NOT NULL AND "deletedAt" IS NULL
    UNION ALL
    SELECT "leadId", "createdAt" AS "at" FROM "Call" WHERE "leadId" IS NOT NULL AND "deletedAt" IS NULL
  ) t
  GROUP BY t."leadId"
) w
WHERE l."firstContactedAt" IS NULL
  AND l."id" = w."leadId";
