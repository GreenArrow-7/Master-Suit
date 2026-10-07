-- A lead's numbers beyond Lead.phone, each with a WhatsApp flag (Lead Eagle
-- plan, gap 2). Hand-written for the reason the proposals migration gives.

CREATE TABLE "LeadPhone" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "raw" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "label" TEXT,
    "isWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadPhone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadPhone_leadId_normalized_key" ON "LeadPhone"("leadId", "normalized");
CREATE INDEX "LeadPhone_tenantId_normalized_idx" ON "LeadPhone"("tenantId", "normalized");

ALTER TABLE "LeadPhone" ADD CONSTRAINT "LeadPhone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadPhone" ADD CONSTRAINT "LeadPhone_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, same policy as every tenant-scoped table.
GRANT SELECT, INSERT, UPDATE, DELETE ON "LeadPhone" TO master_saas_app;
ALTER TABLE "LeadPhone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadPhone" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LeadPhone";
CREATE POLICY tenant_isolation ON "LeadPhone" FOR ALL
  USING (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  );
