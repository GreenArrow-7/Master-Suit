-- Temporary work-location requests and attendance exception requests.
--
-- Both are people-driven routes around the geofence, which is why they are
-- request/approval records rather than switches: an approved temporary site
-- becomes a real date-bounded location so the fence still decides every punch,
-- and an approved exception writes an accepted punch while leaving the
-- original rejection in place as evidence.

-- CreateEnum
CREATE TYPE "HrTemporaryRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "HrExceptionStatus" AS ENUM ('PENDING_MANAGER', 'PENDING_HR', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "HrTemporaryLocationRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "employeeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "HrTemporaryRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdLocationId" TEXT,

    CONSTRAINT "HrTemporaryLocationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAttendanceExceptionRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "requestedAction" "HrPunchType" NOT NULL,
    "requestedFor" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "nearestLocationId" TEXT,
    "distanceM" DOUBLE PRECISION,
    "reasonCode" TEXT NOT NULL,
    "reasonText" TEXT,
    "attachmentName" TEXT,
    "status" "HrExceptionStatus" NOT NULL DEFAULT 'PENDING_MANAGER',
    "managerId" TEXT,
    "managerComment" TEXT,
    "managerAt" TIMESTAMP(3),
    "hrId" TEXT,
    "hrComment" TEXT,
    "hrAt" TIMESTAMP(3),
    "createdPunchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrAttendanceExceptionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrTemporaryLocationRequest_tenantId_status_requestedAt_idx" ON "HrTemporaryLocationRequest"("tenantId", "status", "requestedAt" DESC);

-- CreateIndex
CREATE INDEX "HrAttendanceExceptionRequest_tenantId_status_createdAt_idx" ON "HrAttendanceExceptionRequest"("tenantId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "HrAttendanceExceptionRequest_tenantId_employeeId_createdAt_idx" ON "HrAttendanceExceptionRequest"("tenantId", "employeeId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "HrTemporaryLocationRequest" ADD CONSTRAINT "HrTemporaryLocationRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrTemporaryLocationRequest" ADD CONSTRAINT "HrTemporaryLocationRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrTemporaryLocationRequest" ADD CONSTRAINT "HrTemporaryLocationRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrTemporaryLocationRequest" ADD CONSTRAINT "HrTemporaryLocationRequest_createdLocationId_fkey" FOREIGN KEY ("createdLocationId") REFERENCES "HrWorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendanceExceptionRequest" ADD CONSTRAINT "HrAttendanceExceptionRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendanceExceptionRequest" ADD CONSTRAINT "HrAttendanceExceptionRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendanceExceptionRequest" ADD CONSTRAINT "HrAttendanceExceptionRequest_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendanceExceptionRequest" ADD CONSTRAINT "HrAttendanceExceptionRequest_hrId_fkey" FOREIGN KEY ("hrId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendanceExceptionRequest" ADD CONSTRAINT "HrAttendanceExceptionRequest_nearestLocationId_fkey" FOREIGN KEY ("nearestLocationId") REFERENCES "HrWorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendanceExceptionRequest" ADD CONSTRAINT "HrAttendanceExceptionRequest_createdPunchId_fkey" FOREIGN KEY ("createdPunchId") REFERENCES "HrAttendancePunch"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Row-level security for the tables created above ─────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO master_saas_app;

DO $$
DECLARE
  target TEXT;
BEGIN
  FOR target IN SELECT unnest(ARRAY['HrTemporaryLocationRequest', 'HrAttendanceExceptionRequest'])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO master_saas_app '
      'USING ("tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')) '
      'WITH CHECK ("tenantId" = nullif(current_setting(''app.tenant_id'', true), ''''))',
      target
    );
  END LOOP;
END $$;
