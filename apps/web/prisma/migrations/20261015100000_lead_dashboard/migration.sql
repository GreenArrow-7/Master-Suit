-- The Lead Eagle board (audit rows M3-02, M3-04, M3-10 and M3-14). Additive: one
-- column with a default, and backfills of two columns where they are empty.

-- What a follow-up is for. Every follow-up so far was booked as a call reminder
-- (the call log's "Follow-up call", the Follow-ups composer, a call's page), so
-- CALL is the default; a meeting or a site visit says so. The board's
-- "Callbacks" are the calls due today.
ALTER TABLE "FollowUpTask" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CALL';

SELECT set_config('app.platform_admin', 'on', true);

-- `Lead.firstContactedAt` was never written, so every lead read as never
-- contacted. touchLead stamps it from now on, on contact only; a lead worked
-- before gets the time of its earliest contact, read as touchLead reads it
-- (services/leads/touch.ts):
--   - an activity that is not a note: a logged call, an email, a meeting. The
--     notes intake, imports and the move tool write ("Enquiry via …", a
--     spreadsheet's remarks) contact nobody;
--   - a call we placed (not one only booked, nor one called off), or one that
--     was answered. A missed call from the lead is not contact.
UPDATE "Lead" l
SET "firstContactedAt" = w."firstAt"
FROM (
  SELECT t."leadId", min(t."at") AS "firstAt"
  FROM (
    SELECT a."leadId", a."occurredAt" AS "at"
    FROM "Activity" a
    JOIN "ActivityType" ty ON ty."id" = a."typeId"
    WHERE a."leadId" IS NOT NULL AND a."deletedAt" IS NULL AND ty."key" <> 'note'
    UNION ALL
    SELECT c."leadId", coalesce(c."startedAt", c."createdAt") AS "at"
    FROM "Call" c
    WHERE c."leadId" IS NOT NULL
      AND c."deletedAt" IS NULL
      AND c."status" NOT IN ('SCHEDULED', 'CANCELLED')
      AND (c."direction" = 'OUTBOUND' OR c."status" IN ('IN_PROGRESS', 'COMPLETED'))
  ) t
  GROUP BY t."leadId"
) w
WHERE l."firstContactedAt" IS NULL
  AND l."id" = w."leadId";

-- A lead that came in before the source catalogue (20261012004000) names its
-- portal only in `sourceDetail` (`bayut:<ref>`, `bayut`, `facebook:<id>`): it
-- takes the workspace's entry for that key, so the board names the portal and
-- the lead list's source filter finds it. A referral's or a hand-made lead's
-- detail is typed by a person and is left alone.
UPDATE "Lead" l
SET "sourceId" = s."id"
FROM "LeadSource" s
WHERE l."sourceId" IS NULL
  AND l."source" NOT IN ('REFERRAL', 'MANUAL')
  AND s."tenantId" = l."tenantId"
  AND s."key" = CASE split_part(l."sourceDetail", ':', 1)
    WHEN 'facebook' THEN 'meta'
    ELSE split_part(l."sourceDetail", ':', 1)
  END;
