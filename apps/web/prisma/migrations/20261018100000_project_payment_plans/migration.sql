-- Payment plans per project (Lead Eagle audit row M11-02, 18 Oct): the
-- standalone's PaymentPlan, so a project can say "20/80 post-handover" and the
-- move tool can carry the plans. Additive: one new table; nothing existing
-- changes shape and no row is rewritten.

CREATE TABLE "PaymentPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "milestones" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "PaymentPlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentPlan_tenantId_projectId_idx" ON "PaymentPlan"("tenantId", "projectId");
CREATE UNIQUE INDEX "PaymentPlan_projectId_name_key" ON "PaymentPlan"("projectId", "name");

ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, same policy as every tenant-scoped table.
GRANT SELECT, INSERT, UPDATE, DELETE ON "PaymentPlan" TO master_saas_app;
ALTER TABLE "PaymentPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentPlan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PaymentPlan";
CREATE POLICY tenant_isolation ON "PaymentPlan" FOR ALL
  USING (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  );
