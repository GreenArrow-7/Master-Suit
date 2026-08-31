-- CreateTable
CREATE TABLE "SalesPlaybook" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "leadTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discoveryQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvedClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "objectionGuidance" TEXT,
    "closingStrategy" TEXT,
    "followUpStrategy" TEXT,
    "complianceNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SalesPlaybook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectedRequirement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "leadId" TEXT,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "sourceQuote" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetectedRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesPlaybook_tenantId_isActive_idx" ON "SalesPlaybook"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SalesPlaybook_tenantId_name_key" ON "SalesPlaybook"("tenantId", "name");

-- CreateIndex
CREATE INDEX "DetectedRequirement_tenantId_leadId_idx" ON "DetectedRequirement"("tenantId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "DetectedRequirement_tenantId_callId_field_key" ON "DetectedRequirement"("tenantId", "callId", "field");

-- AddForeignKey
ALTER TABLE "SalesPlaybook" ADD CONSTRAINT "SalesPlaybook_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectedRequirement" ADD CONSTRAINT "DetectedRequirement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Tenant isolation ─────────────────────────────────────────────────────────
-- Same policy as every tenant-scoped table (see 20260819100000): RLS is FORCEd
-- because the migration role owns these tables and an owner bypasses RLS
-- without it — lib/startup-check.ts refuses to boot on exactly that condition.
DO $$
DECLARE
  target text;
  covered text[] := ARRAY['SalesPlaybook', 'DetectedRequirement'];
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
