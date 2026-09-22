-- Coverage grants gain a kind.
--
-- OPERATIONAL is what every existing row means: short on-call coverage of every
-- workspace. CRM_MONITORING is the standing platform-wide read-only CRM
-- authorisation. The default is OPERATIONAL so no existing row silently
-- acquires the longer ceiling, and the column is NOT NULL so nothing can be
-- written without saying which it is.
--
-- Rollback compatibility: an older release does not select this column and
-- reads every row exactly as it did before — as coverage that is read-only,
-- bounded and revocable. It cannot misread a CRM_MONITORING grant as anything
-- wider, because the authority a coverage grant confers has not changed.
CREATE TYPE "PlatformCoverageKind" AS ENUM ('OPERATIONAL', 'CRM_MONITORING');

ALTER TABLE "PlatformCoverageGrant"
  ADD COLUMN "kind" "PlatformCoverageKind" NOT NULL DEFAULT 'OPERATIONAL';

-- The live-grant lookup filters on holder and expiry; kind rides along on it so
-- the directory's "is this person globally authorised for CRM" question is one
-- index hit rather than a scan.
CREATE INDEX "PlatformCoverageGrant_platformUserId_kind_expiresAt_idx"
  ON "PlatformCoverageGrant" ("platformUserId", "kind", "expiresAt");
