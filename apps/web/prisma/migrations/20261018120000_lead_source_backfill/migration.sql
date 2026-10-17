-- Leads from before the source catalogue (20261012004000_lead_record_fields)
-- name their intake only in "sourceDetail" (`bayut:R-1`, `facebook:form`,
-- `data:batch`), with no entry. Link each to its workspace's entry for that
-- intake, so a source filter, the lead list and the source reports count it
-- under one entry and one name (M16-02). A referral's detail is whoever
-- referred it, typed by hand: never an intake. Only fills NULLs.
UPDATE "Lead" AS l
SET "sourceId" = s."id"
FROM "LeadSource" AS s
WHERE l."sourceId" IS NULL
  AND l."source" <> 'REFERRAL'
  AND s."tenantId" = l."tenantId"
  AND s."key" = CASE split_part(l."sourceDetail", ':', 1)
    WHEN 'property_finder' THEN 'property_finder'
    WHEN 'bayut' THEN 'bayut'
    WHEN 'dubizzle' THEN 'dubizzle'
    WHEN 'google_ads' THEN 'google_ads'
    WHEN 'custom_webhook' THEN 'custom_webhook'
    WHEN 'facebook' THEN 'meta'
    WHEN 'data' THEN 'cold_data'
  END;
