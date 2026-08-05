-- Face enrolment and attendance punches.
--
-- HrFaceTemplate holds 512-float ArcFace embeddings; raw enrolment frames are
-- never stored. HrAttendancePunch records every attempt, accepted or rejected,
-- with the location evidence the server measured — the client's claim of where
-- it was standing is never the record.
--
-- The (tenantId, employeeId, clientPunchUid) unique index is what makes offline
-- replay idempotent: the same queued punch synced twice is one row.

-- CreateEnum
CREATE TYPE "HrPunchType" AS ENUM ('CHECK_IN', 'CHECK_OUT');

-- CreateEnum
CREATE TYPE "HrPunchResult" AS ENUM ('ACCEPTED', 'FLAGGED_REVIEW', 'REJECTED_FACE', 'REJECTED_LIVENESS', 'REJECTED_GEOFENCE', 'REJECTED_ACCURACY', 'REJECTED_DUPLICATE', 'REJECTED_STALE_SYNC');

-- CreateTable
CREATE TABLE "HrFaceTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "embedding" BYTEA NOT NULL,
    "dim" INTEGER NOT NULL DEFAULT 512,
    "modelVersion" TEXT NOT NULL DEFAULT 'buffalo_l',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrFaceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrAttendancePunch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "punchType" "HrPunchType" NOT NULL,
    "result" "HrPunchResult" NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'face',
    "serverTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientTime" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "gpsAccuracyM" DOUBLE PRECISION,
    "distanceM" DOUBLE PRECISION,
    "faceScore" DOUBLE PRECISION,
    "livenessScore" DOUBLE PRECISION,
    "deviceFingerprint" TEXT,
    "mockLocationFlag" BOOLEAN NOT NULL DEFAULT false,
    "rejectCode" TEXT,
    "rejectReason" TEXT,
    "syncedOffline" BOOLEAN NOT NULL DEFAULT false,
    "clientPunchUid" TEXT,
    "requestId" TEXT,
    "serverIp" TEXT,
    "locationId" TEXT,
    "locLatitude" DOUBLE PRECISION,
    "locLongitude" DOUBLE PRECISION,
    "locRadiusM" INTEGER,
    "capturePath" TEXT,

    CONSTRAINT "HrAttendancePunch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrFaceTemplate_tenantId_employeeId_idx" ON "HrFaceTemplate"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "HrAttendancePunch_tenantId_employeeId_serverTime_idx" ON "HrAttendancePunch"("tenantId", "employeeId", "serverTime" DESC);

-- CreateIndex
CREATE INDEX "HrAttendancePunch_tenantId_result_serverTime_idx" ON "HrAttendancePunch"("tenantId", "result", "serverTime" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "HrAttendancePunch_tenantId_employeeId_clientPunchUid_key" ON "HrAttendancePunch"("tenantId", "employeeId", "clientPunchUid");

-- AddForeignKey
ALTER TABLE "HrFaceTemplate" ADD CONSTRAINT "HrFaceTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrFaceTemplate" ADD CONSTRAINT "HrFaceTemplate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendancePunch" ADD CONSTRAINT "HrAttendancePunch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendancePunch" ADD CONSTRAINT "HrAttendancePunch_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrAttendancePunch" ADD CONSTRAINT "HrAttendancePunch_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "HrWorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Row-level security for the tables created above ─────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO master_saas_app;

DO $$
DECLARE
  target TEXT;
BEGIN
  FOR target IN SELECT unnest(ARRAY['HrFaceTemplate', 'HrAttendancePunch'])
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
