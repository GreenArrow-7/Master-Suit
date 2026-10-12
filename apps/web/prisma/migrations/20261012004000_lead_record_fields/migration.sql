-- Lead record fields (Lead Eagle audit rows M4-02, M4-03, M4-07, M4-09, 12 Oct).
-- Additive: new columns on Lead, all nullable or defaulted, and the
-- per-workspace source catalogue. Nothing existing changes shape.

-- M4-02: the main number's WhatsApp flag (the other numbers have one on LeadPhone).
--        On by default, so every existing lead keeps the WhatsApp action it has today.
-- M4-03: the catalogue entry a lead was attributed to, and a free-text campaign.
-- M4-07: nationality.
-- M4-09: a second person who works the lead, reached like its owner.
ALTER TABLE "Lead"
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "campaignName" TEXT,
  ADD COLUMN "nationality" TEXT,
  ADD COLUMN "phoneIsWhatsapp" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "secondaryOwnerId" TEXT;

CREATE TABLE "LeadSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadSource_tenantId_key_key" ON "LeadSource"("tenantId", "key");
CREATE INDEX "LeadSource_tenantId_parentId_position_idx" ON "LeadSource"("tenantId", "parentId", "position");
CREATE INDEX "Lead_tenantId_secondaryOwnerId_idx" ON "Lead"("tenantId", "secondaryOwnerId");
CREATE INDEX "Lead_sourceId_idx" ON "Lead"("sourceId");

ALTER TABLE "LeadSource" ADD CONSTRAINT "LeadSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadSource" ADD CONSTRAINT "LeadSource_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "LeadSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_secondaryOwnerId_fkey" FOREIGN KEY ("secondaryOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant isolation, same policy as every tenant-scoped table.
GRANT SELECT, INSERT, UPDATE, DELETE ON "LeadSource" TO master_saas_app;
ALTER TABLE "LeadSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadSource" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LeadSource";
CREATE POLICY tenant_isolation ON "LeadSource" FOR ALL
  USING (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  );
