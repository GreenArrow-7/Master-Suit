-- Scheduled report emails (audit row M16-16, 18 Oct). Additive: one enum and
-- one new table. Nothing existing changes shape and no row is written.

CREATE TYPE "ReportCadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "by" TEXT,
    "cadence" "ReportCadence" NOT NULL,
    "recipients" TEXT[],
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportSchedule_nextRunAt_idx" ON "ReportSchedule"("nextRunAt");
CREATE INDEX "ReportSchedule_tenantId_createdById_idx" ON "ReportSchedule"("tenantId", "createdById");

ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, same policy as every tenant-scoped table. The sweep finds
-- due rows across workspaces inside withPlatformTx, then works each in its own.
GRANT SELECT, INSERT, UPDATE, DELETE ON "ReportSchedule" TO master_saas_app;
ALTER TABLE "ReportSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportSchedule" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ReportSchedule";
CREATE POLICY tenant_isolation ON "ReportSchedule" FOR ALL
  USING (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  );
