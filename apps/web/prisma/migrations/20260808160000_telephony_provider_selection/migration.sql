-- Which telephony vendor places a workspace's calls.
--
-- One nullable column, not a TelephonyConfiguration table.
--
-- The per-vendor credentials, caller number, recording flags and webhook key
-- already have a home in IntegrationConnection, which is unique per
-- (tenantId, provider) and so already supports several configured vendors per
-- workspace. The only fact that had nowhere to live was which of them is the
-- default, and that is one value per workspace. A table would have added a join,
-- a second uniqueness rule and a way for the two stores to disagree about what a
-- workspace's credentials are.
--
-- NULL means "infer": a workspace with exactly one connected vendor does not
-- have to choose, and one with several is refused rather than guessed at.
-- See src/lib/integrations/telephony/resolve.ts.
ALTER TABLE "OrganizationSetting" ADD COLUMN "telephonyProvider" TEXT;

-- The value is read on every dial, so it is worth refusing a typo at the
-- boundary rather than discovering it as "no such provider" at call time.
ALTER TABLE "OrganizationSetting"
    ADD CONSTRAINT "OrganizationSetting_telephonyProvider_check"
    CHECK ("telephonyProvider" IS NULL OR "telephonyProvider" IN ('twilio', 'exotel', 'knowlarity', 'plivo'));

-- No RLS block: OrganizationSetting already carries a tenant_isolation policy
-- from 20260803230000_rls_full_coverage, and a policy is a table-level rule that
-- covers columns added later. Re-running the catalog sweep here would drag in a
-- stale bootstrap exclusion list — see the note in 20260808140000_hr_overtime.
