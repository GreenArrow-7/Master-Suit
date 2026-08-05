-- Administrator-configurable list-grid columns, stored per workspace alongside the
-- other policy blobs on OrganizationSetting. Only the chosen key order is stored, so
-- a column added to the catalogue in a later release appears for every workspace
-- that has not overridden that object type.
ALTER TABLE "OrganizationSetting"
  ADD COLUMN IF NOT EXISTS "gridColumns" JSONB NOT NULL DEFAULT '{}';
