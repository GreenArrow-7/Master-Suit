-- Check-out quota: an unmet daily target can stop somebody checking out.
--
-- Hand-written, for the reason the last three migrations give: `migrate diff`
-- against this database also emits DROP TABLE "PlatformCoverageGrant" and drops
-- two "PlatformAccessGrant" columns, because two applied migrations are absent
-- from the repository.
--
-- On OrganizationSetting rather than the hrPolicy JSON, where the other
-- attendance parameters live. Two reasons, both practical: hrPolicy's writer
-- refuses anyone who is not an HR administrator, and the rule belongs to
-- whoever sets the sales targets; and its settings screen is behind the HRMS
-- module, so a brokerage licensing Sales alone could never switch this on.
--
-- The default is off. Turning an attendance gate on is a decision a company
-- makes, not one a release makes for it.

ALTER TABLE "OrganizationSetting"
  ADD COLUMN "requireTargetsBeforeCheckOut" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "checkOutQuotaMetrics"         TEXT[] NOT NULL DEFAULT ARRAY['CALLS_ATTEMPTED']::TEXT[],
  ADD COLUMN "checkOutQuotaMaxHours"        INTEGER NOT NULL DEFAULT 10;

-- The ceiling is a statutory guard, not a preference: without it the gate can
-- record a working day of any length. Four hours is the floor because anything
-- shorter makes the gate meaningless; sixteen is above every lawful daily
-- maximum this product ships to, so the column cannot express one.
ALTER TABLE "OrganizationSetting"
  ADD CONSTRAINT "OrganizationSetting_check_out_hours_are_lawful"
  CHECK ("checkOutQuotaMaxHours" BETWEEN 4 AND 16);
