-- Full row-level-security coverage for tenant-owned tables.
--
-- Before this migration RLS was enabled on 26 tables while 115 carry tenantId,
-- and the runtime connected as a superuser that bypasses RLS regardless. This
-- closes both halves: every tenant-owned table gets a policy, and the
-- application role is given LOGIN so production can actually connect as a
-- NOBYPASSRLS principal (see docs/RLS-ROLLOUT.md).

-- ── Application role ────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'master_saas_app') THEN
    CREATE ROLE master_saas_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

-- LOGIN so DATABASE_URL can name it directly. The password is a placeholder for
-- local development; deployments rotate it out of band and never commit it.
ALTER ROLE master_saas_app LOGIN;
DO $$ BEGIN
  IF current_setting('server_version_num')::int >= 100000 THEN
    EXECUTE format('ALTER ROLE master_saas_app PASSWORD %L',
                   coalesce(nullif(current_setting('master_saas.app_password', true), ''), 'master_saas_app'));
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO master_saas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO master_saas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO master_saas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO master_saas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO master_saas_app;

-- ── Policies ────────────────────────────────────────────────────────────────
-- Driven from the catalog rather than a hand-kept list, so a new tenant-owned
-- table is covered the moment it exists instead of silently opting out.
--
-- The exclusions are the tables the application must reach *before* a tenant is
-- known: session/API-key/webhook-key lookups by a global bearer secret are how
-- the tenant gets resolved in the first place, and the control-plane tables are
-- cross-tenant by design and gated by requirePlatformOwner instead. This list
-- deliberately mirrors GLOBAL_MODELS + GLOBAL_UNIQUE_FIELDS in src/lib/db.ts.
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
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO master_saas_app '
      'USING ("tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')) '
      'WITH CHECK ("tenantId" = nullif(current_setting(''app.tenant_id'', true), ''''))',
      target
    );
  END LOOP;
END $$;
