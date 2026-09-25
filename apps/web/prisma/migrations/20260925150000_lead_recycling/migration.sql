-- Lead recycling: a cooling-off period and an attempt ceiling over lost leads.
--
-- Hand-written rather than generated, for the reason the two portal migrations
-- give: `prisma migrate diff` against this database also emits DROP TABLE
-- "PlatformCoverageGrant" and drops two "PlatformAccessGrant" columns, because
-- two applied migrations are missing from the repository.
--
-- No backfill and no index. "When did this lead go cold" is already recorded in
-- "LeadStageHistory", which has an index on (tenantId, toStageId, createdAt) —
-- so recycling reads history that every existing row already has, rather than a
-- new timestamp column that would be null for every lead lost before today.

ALTER TABLE "Lead"
  ADD COLUMN "recycleCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recycledAt"   TIMESTAMP(3);

ALTER TABLE "OrganizationSetting"
  ADD COLUMN "leadRecycleAfterDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leadRecycleMaxTimes"  INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "leadRecycleStageId"   TEXT;
