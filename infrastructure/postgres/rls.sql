-- Apply only after every request/background job runs inside a transaction that
-- executes: SELECT set_config('app.tenant_id', <tenant-id>, true)
-- The policy intentionally fails closed when no tenant context exists.
DO $$
DECLARE
  tenant_table record;
BEGIN
  FOR tenant_table IN
    SELECT DISTINCT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenantId'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tenant_table.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tenant_table.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', tenant_table.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I FOR ALL TO master_saas_app '
      'USING ("tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')) '
      'WITH CHECK ("tenantId" = nullif(current_setting(''app.tenant_id'', true), ''''))',
      tenant_table.table_name
    );
  END LOOP;
END $$;
