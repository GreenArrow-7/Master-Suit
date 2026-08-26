-- Bring HrOvertimeRequest's row-level security up to the same shape as every
-- other tenant-owned table.
--
-- 20260808140000_hr_overtime wrote its own policy rather than re-running the
-- catalog sweep, which was the right call — docs/KNOWN-LIMITATIONS.md records
-- why pasting the sweep into a feature migration is a trap. But the hand-written
-- version was copied from the *pre-20260806000000* shape and lost two things
-- that had been added since. Nothing noticed, because a policy that exists and
-- is wrong looks identical to one that is right in `\d`.
--
--   1. FORCE ROW LEVEL SECURITY was missing.
--      A table owner bypasses RLS unconditionally unless the table is FORCEd, and
--      no role attribute reveals it. `lib/startup-check.ts` refuses to boot when
--      the *connecting* role owns such a table, so this was invisible in
--      production — where the application connects as master_saas_app, which owns
--      nothing — while the owning role read every tenant's overtime claims.
--
--   2. The `app.platform_admin` branch was missing, and the policy was scoped
--      `TO master_saas_app`.
--      That is a live functional fault, not only a latent one: `withPlatformTx`
--      asserts `app.platform_admin` and names no tenant, so on this table it
--      matched nothing. Every cross-tenant operation was silently blind to
--      overtime — the platform console, and the retention sweep in
--      lib/jobs/retention.ts.
--
-- Caught by scripts/check-rls.mjs on its first run, which is now a CI gate.

ALTER TABLE "HrOvertimeRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrOvertimeRequest" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "HrOvertimeRequest";

-- `FOR ALL` with no role, exactly as 20260806000000 writes it: scoping a policy
-- TO one role means it simply does not apply to any other, which is the opposite
-- of what a tenant-isolation policy is for.
CREATE POLICY tenant_isolation ON "HrOvertimeRequest" FOR ALL
  USING (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  );
