-- What a Facebook Lead Ad form becomes when its leads reach the CRM.
--
-- The webhook already carried the form id and had nowhere to look up what that
-- form means, so every Meta lead landed on the default stage with no owner.
-- Stage, priority and source reference the existing LeadStage / Priority /
-- RecordSource rather than Meta-only copies, and there is no assignment-strategy
-- column: naming neither a user nor a team falls through to the DistributionRule
-- engine that already does round-robin and load balancing.

CREATE TABLE "MetaLeadFormRouting" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "providerFormId" TEXT NOT NULL,
  "providerPageId" TEXT,
  "formName"       TEXT NOT NULL,
  "enabled"        BOOLEAN NOT NULL DEFAULT true,
  "source"         "RecordSource" NOT NULL DEFAULT 'AD_LEAD_FORM',
  "stageId"        TEXT,
  "priority"       "Priority" NOT NULL DEFAULT 'MEDIUM',
  "assignedUserId" TEXT,
  "assignedTeamId" TEXT,
  "notifyOwner"    BOOLEAN NOT NULL DEFAULT true,
  "lastLeadAt"     TIMESTAMP(3),
  "lastSyncAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetaLeadFormRouting_pkey" PRIMARY KEY ("id")
);

-- The webhook's lookup key. Scoped by tenant, so two workspaces may hold the
-- same Meta form id without colliding, and so one tenant's form maps exactly
-- once — which is also what makes repeated ingestion idempotent on this side.
CREATE UNIQUE INDEX "MetaLeadFormRouting_tenantId_providerFormId_key"
  ON "MetaLeadFormRouting"("tenantId", "providerFormId");
CREATE INDEX "MetaLeadFormRouting_tenantId_enabled_idx"
  ON "MetaLeadFormRouting"("tenantId", "enabled");

ALTER TABLE "MetaLeadFormRouting" ADD CONSTRAINT "MetaLeadFormRouting_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL, not CASCADE: deleting a stage or disbanding a team must not silently
-- delete the routing rule and quietly stop leads arriving.
ALTER TABLE "MetaLeadFormRouting" ADD CONSTRAINT "MetaLeadFormRouting_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "LeadStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MetaLeadFormRouting" ADD CONSTRAINT "MetaLeadFormRouting_assignedUserId_fkey"
  FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MetaLeadFormRouting" ADD CONSTRAINT "MetaLeadFormRouting_assignedTeamId_fkey"
  FOREIGN KEY ("assignedTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Layer 3 of the tenant defence. Without FORCE the owning role reads every
-- tenant's routing rules regardless of policy, and lib/startup-check.ts refuses
-- to boot on exactly that condition.
DO $$
DECLARE
  target TEXT;
  covered CONSTANT TEXT[] := ARRAY['MetaLeadFormRouting'];
BEGIN
  FOREACH target IN ARRAY covered LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO master_saas_app', target);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
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
