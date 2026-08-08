-- Row-level security for the five tables holding recorded client conversations.
--
-- RecordingConsent, Recording, Transcript, AIAnalysis and CallAudit were on the
-- bootstrap exclusion list in 20260803230000_rls_full_coverage and stayed there
-- through 20260806000000_rls_force_and_platform_admin. They are the only tables
-- on that list which are not a bootstrap case.
--
-- A bootstrap exclusion is for a lookup that *cannot* name a tenant because
-- resolving the tenant is the point of the lookup: a session token, a password
-- reset link, an invitation, a webhook key. These five were excluded for a
-- different reason — the code reached them by `callId`, which is unique, so
-- `findUnique({ where: { callId } })` compiled and the tenant guard had to be
-- told to allow it. Every one of those call sites already knew the tenant.
--
-- The consequence was that a transcript, an AI summary of what a client said,
-- and the audio itself were the least protected rows in the database: the one
-- category of data here that is a recording of a real person's voice.
--
-- The call sites now pass tenantId alongside callId (src/lib/db.ts no longer
-- exempts them), so the policy has a value to enforce.

DO $$
DECLARE
  target TEXT;
  covered CONSTANT TEXT[] := ARRAY[
    'RecordingConsent', 'Recording', 'Transcript', 'AIAnalysis', 'CallAudit'
  ];
BEGIN
  FOREACH target IN ARRAY covered LOOP
    -- Named explicitly rather than re-running the catalog sweep. A migration
    -- that covers five tables only needs policies on five tables, and re-running
    -- the sweep would carry a stale copy of the bootstrap list — the mistake
    -- documented in 20260808140000_hr_overtime.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO master_saas_app', target);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    -- FORCE, because the migration role owns these tables and an owner bypasses
    -- RLS unconditionally without it — no role attribute reveals that.
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

-- `current_setting(..., true)` returns NULL rather than erroring on a connection
-- that never set it. NULL fails both branches, which is the fail-closed
-- direction: a query with no tenant context sees nothing at all.
