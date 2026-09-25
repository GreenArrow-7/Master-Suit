-- The agency's broker registration number, carried at agency level in a portal
-- feed. Hand-written for the same reason as the last one: `migrate diff` against
-- this database also emits drops for platform-monitoring tables that two
-- unrecorded migrations created.
ALTER TABLE "OrganizationSetting" ADD COLUMN "reraOrn" TEXT;
