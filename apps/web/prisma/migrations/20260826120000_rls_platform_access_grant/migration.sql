-- Row-level security for PlatformAccessGrant.
--
-- 20260820170000_platform_access_grant created this table outside RLS and wrote
-- the reason down: "the lookup that decides whether the actor may write is the
-- one that would have to set `app.tenant_id`, and a policy here would make that
-- lookup match nothing".
--
-- That is not what the lookup does. `activeGrant(platformUserId, tenantId)` is
-- handed the tenant by its caller — `buildSupportActor` already knows which
-- workspace is being opened, because the URL said so — and asks whether this
-- person holds a live grant *into that workspace*. The tenant is an input, not
-- the answer. src/lib/db.ts pins `app.tenant_id` from that very `where` clause
-- before the query runs, and does the same for the create in `openGrant` and the
-- updateMany in `revokeGrants`. A policy has a value to enforce on all three.
--
-- This is the shape 20260808200000_rls_call_intelligence removed from five other
-- tables: an exclusion justified by a bootstrap story that was not one. The cost
-- here is the same in kind. PlatformAccessGrant is the row that turns a platform
-- owner from read-only into full control inside a customer's workspace, and it
-- was the one authority-granting table in the database with no policy on it — so
-- a query that reached this table with any tenant's context, or none, could read
-- who has been inside which customer and why, or insert a grant naming a
-- workspace it had no business in.
--
-- `liveGrantCount` (the /api/metrics gauge) is the one caller that legitimately
-- spans tenants; it now runs under `withPlatformTx`, which the platform_admin
-- branch below admits.

GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformAccessGrant" TO master_saas_app;
ALTER TABLE "PlatformAccessGrant" ENABLE ROW LEVEL SECURITY;
-- FORCE, because the migration role owns the table and an owner bypasses RLS
-- unconditionally without it — no role attribute reveals that.
ALTER TABLE "PlatformAccessGrant" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "PlatformAccessGrant";
CREATE POLICY tenant_isolation ON "PlatformAccessGrant" FOR ALL
  USING (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  );

-- `current_setting(..., true)` returns NULL rather than erroring on a connection
-- that never set it. NULL fails both branches, which is the fail-closed
-- direction: a query with no tenant context sees no grants at all.
