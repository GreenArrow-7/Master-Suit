-- Make row-level security apply to the process that actually serves traffic.
--
-- 20260803230000_rls_full_coverage enabled RLS and wrote a policy `TO
-- master_saas_app`. Two things stopped it protecting anything:
--
--   1. The application connected as `leadflow`, which *owns* the tables.
--      A table owner bypasses RLS unconditionally unless the table is marked
--      FORCE ROW LEVEL SECURITY, and it was not. The policy also does not name
--      that role, so even without ownership it would not have applied.
--   2. Nothing set `app.tenant_id` inside an interactive transaction, so the
--      moment the connection role *was* corrected, every INSERT and UPDATE
--      inside withTx would have failed its WITH CHECK. That half is fixed in
--      src/lib/db.ts in the same change as this migration; neither is safe to
--      ship without the other.
--
-- This migration closes (1) and adds the control-plane escape hatch that (2)
-- needs: `app.platform_admin`, asserted only by withPlatformTx, which every
-- caller reaches through requirePlatformOwner.

-- ── Application role ────────────────────────────────────────────────────────
-- Recreated defensively: a database restored from before the previous migration,
-- or provisioned by infrastructure rather than by Prisma, may not have it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'master_saas_app') THEN
    CREATE ROLE master_saas_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS LOGIN;
  END IF;
END $$;

-- Belt and braces: an existing role could predate the NOBYPASSRLS intent.
ALTER ROLE master_saas_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS LOGIN;

DO $$ BEGIN
  EXECUTE format('ALTER ROLE master_saas_app PASSWORD %L',
                 coalesce(nullif(current_setting('master_saas.app_password', true), ''), 'master_saas_app'));
END $$;

GRANT USAGE ON SCHEMA public TO master_saas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO master_saas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO master_saas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO master_saas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO master_saas_app;

-- CREATE is granted, narrowly and knowingly: services/shared/reference.ts
-- allocates a per-tenant sequence on first use (`CREATE SEQUENCE ref_lead_<id>`),
-- so the application role cannot run without it. Postgres has no privilege for
-- "sequences only", so this is the smallest grant that works.
--
-- It does NOT confer anything over existing tables: ownership stays with the
-- migration role, so the application role cannot ALTER, DROP, or disable a
-- policy on any table it does not itself create.
GRANT CREATE ON SCHEMA public TO master_saas_app;

-- ── Policies: FORCE, and the platform-admin escape ──────────────────────────
-- Same catalog-driven loop as the original migration, so a tenant-owned table
-- added since is covered rather than silently opting out.
DO $$
DECLARE
  target TEXT;
  bootstrap CONSTANT TEXT[] := ARRAY[
    'Session', 'PlatformSession', 'APIKey', 'IntegrationConnection',
    'PasswordResetToken', 'RateLimitCounter',
    'RecordingConsent', 'Recording', 'Transcript', 'AIAnalysis', 'CallAudit',
    'PlatformUser', 'WorkspaceMembership', 'PlatformAuditEvent', 'AuthenticationFactor'
  ];
BEGIN
  FOR target IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN pg_tables t ON t.tablename = c.table_name AND t.schemaname = 'public'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenantId'
      AND NOT (c.table_name = ANY (bootstrap))
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    -- The line that was missing. Without it the owner — and anything that ever
    -- becomes the owner — reads and writes every tenant's rows.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING ('
      '  "tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')'
      '  OR current_setting(''app.platform_admin'', true) = ''on'''
      ') '
      'WITH CHECK ('
      '  "tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')'
      '  OR current_setting(''app.platform_admin'', true) = ''on'''
      ')',
      target
    );
  END LOOP;
END $$;

-- Both settings are always readable, so `current_setting(..., true)` returns
-- NULL rather than erroring when a connection has never set them. NULL fails
-- both branches, which is the fail-closed direction: a query with no tenant
-- context sees nothing.
