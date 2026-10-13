-- Lead requirement, interest links and scoring (Lead Eagle audit rows M4-05,
-- M4-06, M4-08, M4-11, 13 Oct). Additive: two nullable or defaulted columns on
-- ClientRequirement, one defaulted column on LeadSource, and two join tables.
-- Nothing existing changes shape and no row is rewritten.

-- M4-05: the property sub-type and the areas a client asked for, as typed.
ALTER TABLE "ClientRequirement" ADD COLUMN     "locations" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "subType" TEXT;

-- M4-11: a new lead from this source starts with this many points. 0 for every
-- existing entry, so no lead's score changes on deploy.
ALTER TABLE "LeadSource" ADD COLUMN     "weight" INTEGER NOT NULL DEFAULT 0;

-- M4-06: the projects and listings a lead asked about.
CREATE TABLE "LeadProject" (
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "LeadProject_pkey" PRIMARY KEY ("leadId","projectId")
);

CREATE TABLE "LeadListing" (
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "LeadListing_pkey" PRIMARY KEY ("leadId","listingId")
);

CREATE INDEX "LeadProject_tenantId_projectId_idx" ON "LeadProject"("tenantId", "projectId");
CREATE INDEX "LeadListing_tenantId_listingId_idx" ON "LeadListing"("tenantId", "listingId");

ALTER TABLE "LeadProject" ADD CONSTRAINT "LeadProject_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadProject" ADD CONSTRAINT "LeadProject_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadProject" ADD CONSTRAINT "LeadProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadListing" ADD CONSTRAINT "LeadListing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadListing" ADD CONSTRAINT "LeadListing_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadListing" ADD CONSTRAINT "LeadListing_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, same policy as every tenant-scoped table.
GRANT SELECT, INSERT, UPDATE, DELETE ON "LeadProject" TO master_saas_app;
ALTER TABLE "LeadProject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadProject" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LeadProject";
CREATE POLICY tenant_isolation ON "LeadProject" FOR ALL
  USING (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "LeadListing" TO master_saas_app;
ALTER TABLE "LeadListing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadListing" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LeadListing";
CREATE POLICY tenant_isolation ON "LeadListing" FOR ALL
  USING (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  );
