-- Brings the database up to schema.prisma for the HR module.
--
-- schema.prisma declared HrLeaveBalance, HrChecklistTask, HrOffboardingCase,
-- HrSettlementSnapshot and HrEmployeeLocationAssignment, plus salary/exit
-- columns on EmployeeProfile and accrual columns on HrLeaveType, but no
-- migration ever created them. Leave balances, onboarding/offboarding
-- checklists and final settlement could not run against the real database.
-- Generated with `prisma migrate diff`; additive only, no drops.

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "eventId" TEXT;

-- AlterTable
ALTER TABLE "EmployeeProfile" ADD COLUMN     "basicSalary" DECIMAL(14,2),
ADD COLUMN     "exitedOn" TIMESTAMP(3),
ADD COLUMN     "reraBrn" TEXT,
ADD COLUMN     "reraExpiry" TIMESTAMP(3),
ADD COLUMN     "totalSalary" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "HrEmployeeDocument" ADD COLUMN     "contentType" TEXT,
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "number" TEXT,
ADD COLUMN     "originalFilename" TEXT,
ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "sizeBytes" INTEGER;

-- AlterTable
ALTER TABLE "HrLeaveRequest" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "halfDay" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "HrLeaveType" ADD COLUMN     "accrues" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maxCarryForward" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "HrWorkLocation" ADD COLUMN     "address" TEXT,
ADD COLUMN     "closingTime" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'United Arab Emirates',
ADD COLUMN     "effectiveFrom" TIMESTAMP(3),
ADD COLUMN     "effectiveTo" TIMESTAMP(3),
ADD COLUMN     "emirate" TEXT,
ADD COLUMN     "locationType" TEXT NOT NULL DEFAULT 'BRANCH_OFFICE',
ADD COLUMN     "maxAccuracyMeters" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "openingTime" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "workingDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "MembershipRole" ADD COLUMN     "assignedById" TEXT,
ADD COLUMN     "effectiveFrom" TIMESTAMP(3),
ADD COLUMN     "effectiveTo" TIMESTAMP(3),
ADD COLUMN     "revocationReason" TEXT,
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedById" TEXT,
ADD COLUMN     "scopeId" TEXT,
ADD COLUMN     "scopeType" TEXT NOT NULL DEFAULT 'ORGANIZATION',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "HrLeaveBalance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "entitledDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "accruedDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "takenDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carriedForwardDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrLeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrEmployeeLocationAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "assignmentType" TEXT NOT NULL DEFAULT 'PRIMARY',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "checkInAllowed" BOOLEAN NOT NULL DEFAULT true,
    "checkOutAllowed" BOOLEAN NOT NULL DEFAULT true,
    "allowedDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "allowedStartTime" TEXT,
    "allowedEndTime" TEXT,
    "checkoutRule" TEXT NOT NULL DEFAULT 'SAME_LOCATION',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,

    CONSTRAINT "HrEmployeeLocationAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrChecklistTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerDepartment" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrChecklistTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrOffboardingCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "noticeGivenOn" TIMESTAMP(3) NOT NULL,
    "noticePeriodDays" INTEGER NOT NULL,
    "lastWorkingOn" TIMESTAMP(3) NOT NULL,
    "separationType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "noticeShortfallDays" INTEGER NOT NULL DEFAULT 0,
    "settlementPaidAt" TIMESTAMP(3),
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "HrOffboardingCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrSettlementSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "offboardingCaseId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "calculation" JSONB NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrSettlementSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrLeaveBalance_tenantId_year_employeeId_idx" ON "HrLeaveBalance"("tenantId", "year", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "HrLeaveBalance_tenantId_employeeId_leaveTypeId_year_key" ON "HrLeaveBalance"("tenantId", "employeeId", "leaveTypeId", "year");

-- CreateIndex
CREATE INDEX "HrEmployeeLocationAssignment_tenantId_employeeId_status_eff_idx" ON "HrEmployeeLocationAssignment"("tenantId", "employeeId", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "HrEmployeeLocationAssignment_tenantId_locationId_status_idx" ON "HrEmployeeLocationAssignment"("tenantId", "locationId", "status");

-- CreateIndex
CREATE INDEX "HrChecklistTask_tenantId_phase_completedAt_dueDate_idx" ON "HrChecklistTask"("tenantId", "phase", "completedAt", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "HrChecklistTask_tenantId_employeeId_phase_title_key" ON "HrChecklistTask"("tenantId", "employeeId", "phase", "title");

-- CreateIndex
CREATE INDEX "HrOffboardingCase_tenantId_employeeId_completedAt_idx" ON "HrOffboardingCase"("tenantId", "employeeId", "completedAt");

-- CreateIndex
CREATE INDEX "HrSettlementSnapshot_tenantId_employeeId_calculatedAt_idx" ON "HrSettlementSnapshot"("tenantId", "employeeId", "calculatedAt" DESC);

-- CreateIndex
CREATE INDEX "Call_tenantId_eventId_createdAt_idx" ON "Call"("tenantId", "eventId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "HrWorkLocation_tenantId_status_effectiveFrom_effectiveTo_idx" ON "HrWorkLocation"("tenantId", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "HrWorkLocation_tenantId_code_key" ON "HrWorkLocation"("tenantId", "code");

-- CreateIndex
CREATE INDEX "MembershipRole_tenantId_membershipId_status_effectiveFrom_e_idx" ON "MembershipRole"("tenantId", "membershipId", "status", "effectiveFrom", "effectiveTo");

-- AddForeignKey
ALTER TABLE "HrLeaveBalance" ADD CONSTRAINT "HrLeaveBalance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrLeaveBalance" ADD CONSTRAINT "HrLeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrLeaveBalance" ADD CONSTRAINT "HrLeaveBalance_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "HrLeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployeeLocationAssignment" ADD CONSTRAINT "HrEmployeeLocationAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployeeLocationAssignment" ADD CONSTRAINT "HrEmployeeLocationAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployeeLocationAssignment" ADD CONSTRAINT "HrEmployeeLocationAssignment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "HrWorkLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrEmployeeLocationAssignment" ADD CONSTRAINT "HrEmployeeLocationAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrChecklistTask" ADD CONSTRAINT "HrChecklistTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrChecklistTask" ADD CONSTRAINT "HrChecklistTask_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrChecklistTask" ADD CONSTRAINT "HrChecklistTask_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrOffboardingCase" ADD CONSTRAINT "HrOffboardingCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrOffboardingCase" ADD CONSTRAINT "HrOffboardingCase_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrOffboardingCase" ADD CONSTRAINT "HrOffboardingCase_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSettlementSnapshot" ADD CONSTRAINT "HrSettlementSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSettlementSnapshot" ADD CONSTRAINT "HrSettlementSnapshot_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HrSettlementSnapshot" ADD CONSTRAINT "HrSettlementSnapshot_offboardingCaseId_fkey" FOREIGN KEY ("offboardingCaseId") REFERENCES "HrOffboardingCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Row-level security for the tables created above ─────────────────────────
-- Same catalog-driven block as 20260803230000_rls_full_coverage: re-running it
-- covers the new tenant-owned tables. Without this they would be the only HR
-- tables in the schema without a tenant_isolation policy.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO master_saas_app;

DO $$
DECLARE
  target TEXT;
  bootstrap CONSTANT TEXT[] := ARRAY[
    'Session', 'PlatformSession', 'APIKey', 'IntegrationConnection',
    'PasswordResetToken', 'RateLimitCounter',
    'RecordingConsent', 'Recording', 'Transcript', 'AIAnalysis', 'CallAudit',
    'PlatformUser', 'WorkspaceMembership', 'PlatformAuditEvent', 'AuthenticationFactor'
  ];
BEGIN
  FOR target IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN pg_tables t ON t.tablename = c.table_name AND t.schemaname = 'public'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenantId'
      AND NOT (c.table_name = ANY (bootstrap))
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
