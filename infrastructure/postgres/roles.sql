-- Run as the managed PostgreSQL administrator. Login credentials should be
-- assigned through the provider/secret manager, never committed here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'master_saas_app') THEN
    CREATE ROLE master_saas_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'master_saas_migrator') THEN
    CREATE ROLE master_saas_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO master_saas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO master_saas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO master_saas_app;

ALTER DEFAULT PRIVILEGES FOR ROLE master_saas_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO master_saas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE master_saas_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO master_saas_app;
