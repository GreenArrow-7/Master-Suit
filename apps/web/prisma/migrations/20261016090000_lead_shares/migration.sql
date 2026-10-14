-- A project or a listing shared with a lead as a public page (Lead Eagle audit
-- row M4-30, 13 Oct). Additive: one new table. Nothing existing changes shape
-- and no row is written.

CREATE TABLE "LeadShare" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "projectId" TEXT,
    "listingId" TEXT,
    "createdById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadShare_pkey" PRIMARY KEY ("id"),
    -- One project or one listing, never both or neither.
    CONSTRAINT "LeadShare_one_target" CHECK (("projectId" IS NULL) <> ("listingId" IS NULL))
);

CREATE INDEX "LeadShare_tenantId_leadId_createdAt_idx" ON "LeadShare"("tenantId", "leadId", "createdAt" DESC);

ALTER TABLE "LeadShare" ADD CONSTRAINT "LeadShare_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadShare" ADD CONSTRAINT "LeadShare_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadShare" ADD CONSTRAINT "LeadShare_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadShare" ADD CONSTRAINT "LeadShare_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, same policy as every tenant-scoped table. The public page
-- reads it with the tenant its signed token carries, so it needs no exception.
GRANT SELECT, INSERT, UPDATE, DELETE ON "LeadShare" TO master_saas_app;
ALTER TABLE "LeadShare" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadShare" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LeadShare";
CREATE POLICY tenant_isolation ON "LeadShare" FOR ALL
  USING (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  );
