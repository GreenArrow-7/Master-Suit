-- Workspace-owned HRMS and normalized commercial subscription model.
CREATE TYPE "HrAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'REMOTE', 'ON_LEAVE');
CREATE TYPE "HrLeaveStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELED');

ALTER TABLE "Tenant" ADD COLUMN "workspaceName" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "EmployeeProfile" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "designationId" TEXT;

CREATE TABLE "PlanModule" (
  "id" TEXT NOT NULL, "planId" TEXT NOT NULL, "module" "ModuleKey" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlanModule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanModule_planId_module_key" ON "PlanModule"("planId", "module");
ALTER TABLE "PlanModule" ADD CONSTRAINT "PlanModule_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PlanLimit" (
  "id" TEXT NOT NULL, "planId" TEXT NOT NULL, "key" TEXT NOT NULL, "value" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlanLimit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanLimit_planId_key_key" ON "PlanLimit"("planId", "key");
ALTER TABLE "PlanLimit" ADD CONSTRAINT "PlanLimit_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SubscriptionModule" (
  "id" TEXT NOT NULL, "subscriptionId" TEXT NOT NULL, "module" "ModuleKey" NOT NULL,
  "state" "SubscriptionState" NOT NULL DEFAULT 'ACTIVE', "limits" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubscriptionModule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SubscriptionModule_subscriptionId_module_key" ON "SubscriptionModule"("subscriptionId", "module");
ALTER TABLE "SubscriptionModule" ADD CONSTRAINT "SubscriptionModule_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "TenantSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkspaceUsage" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "metric" TEXT NOT NULL, "used" INTEGER NOT NULL DEFAULT 0,
  "limit" INTEGER, "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceUsage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceUsage_tenantId_metric_key" ON "WorkspaceUsage"("tenantId", "metric");
CREATE INDEX "WorkspaceUsage_tenantId_measuredAt_idx" ON "WorkspaceUsage"("tenantId", "measuredAt");
ALTER TABLE "WorkspaceUsage" ADD CONSTRAINT "WorkspaceUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BillingEvent" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "subscriptionId" TEXT, "type" TEXT NOT NULL,
  "amountMinor" INTEGER, "currency" TEXT, "externalId" TEXT, "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BillingEvent_tenantId_occurredAt_idx" ON "BillingEvent"("tenantId", "occurredAt" DESC);
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "TenantSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AuthenticationFactor" (
  "id" TEXT NOT NULL, "platformUserId" TEXT NOT NULL, "type" TEXT NOT NULL, "secret" TEXT,
  "verifiedAt" TIMESTAMP(3), "lastUsedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthenticationFactor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuthenticationFactor_platformUserId_type_idx" ON "AuthenticationFactor"("platformUserId", "type");
ALTER TABLE "AuthenticationFactor" ADD CONSTRAINT "AuthenticationFactor_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MembershipRole" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "membershipId" TEXT NOT NULL, "roleId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MembershipRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MembershipRole_membershipId_roleId_key" ON "MembershipRole"("membershipId", "roleId");
CREATE INDEX "MembershipRole_tenantId_roleId_idx" ON "MembershipRole"("tenantId", "roleId");
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "WorkspaceMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Designation" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "name" TEXT NOT NULL, "code" TEXT NOT NULL, "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Designation_tenantId_code_key" ON "Designation"("tenantId", "code");
CREATE INDEX "Designation_tenantId_name_idx" ON "Designation"("tenantId", "name");
ALTER TABLE "Designation" ADD CONSTRAINT "Designation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "HrShift" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "name" TEXT NOT NULL, "code" TEXT NOT NULL,
  "startTime" TEXT NOT NULL, "endTime" TEXT NOT NULL, "workingDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "HrShift_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrShift_tenantId_code_key" ON "HrShift"("tenantId", "code");
ALTER TABLE "HrShift" ADD CONSTRAINT "HrShift_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HrEmployeeShift" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "shiftId" TEXT NOT NULL,
  "effectiveOn" TIMESTAMP(3) NOT NULL, "endsOn" TIMESTAMP(3), CONSTRAINT "HrEmployeeShift_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrEmployeeShift_tenantId_employeeId_effectiveOn_idx" ON "HrEmployeeShift"("tenantId", "employeeId", "effectiveOn");
ALTER TABLE "HrEmployeeShift" ADD CONSTRAINT "HrEmployeeShift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrEmployeeShift" ADD CONSTRAINT "HrEmployeeShift_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "HrShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HrWorkLocation" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "name" TEXT NOT NULL, "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL, "radiusMeters" INTEGER NOT NULL DEFAULT 150, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HrWorkLocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrWorkLocation_tenantId_name_key" ON "HrWorkLocation"("tenantId", "name");
ALTER TABLE "HrWorkLocation" ADD CONSTRAINT "HrWorkLocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HrAttendanceRecord" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "workDate" TIMESTAMP(3) NOT NULL,
  "checkInAt" TIMESTAMP(3), "checkOutAt" TIMESTAMP(3), "status" "HrAttendanceStatus" NOT NULL DEFAULT 'PRESENT',
  "workMinutes" INTEGER, "locationId" TEXT, "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "HrAttendanceRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrAttendanceRecord_tenantId_employeeId_workDate_key" ON "HrAttendanceRecord"("tenantId", "employeeId", "workDate");
CREATE INDEX "HrAttendanceRecord_tenantId_workDate_status_idx" ON "HrAttendanceRecord"("tenantId", "workDate", "status");
ALTER TABLE "HrAttendanceRecord" ADD CONSTRAINT "HrAttendanceRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrAttendanceRecord" ADD CONSTRAINT "HrAttendanceRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrAttendanceRecord" ADD CONSTRAINT "HrAttendanceRecord_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "HrWorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "HrLeaveType" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "name" TEXT NOT NULL, "code" TEXT NOT NULL,
  "annualAllowance" DOUBLE PRECISION NOT NULL DEFAULT 0, "paid" BOOLEAN NOT NULL DEFAULT true,
  "requiresDocument" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "HrLeaveType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrLeaveType_tenantId_code_key" ON "HrLeaveType"("tenantId", "code");
ALTER TABLE "HrLeaveType" ADD CONSTRAINT "HrLeaveType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HrLeaveRequest" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "leaveTypeId" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL, "endDate" TIMESTAMP(3) NOT NULL, "days" DOUBLE PRECISION NOT NULL,
  "reason" TEXT, "status" "HrLeaveStatus" NOT NULL DEFAULT 'PENDING', "approverId" TEXT,
  "decidedAt" TIMESTAMP(3), "decisionNote" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "HrLeaveRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrLeaveRequest_tenantId_status_startDate_idx" ON "HrLeaveRequest"("tenantId", "status", "startDate");
CREATE INDEX "HrLeaveRequest_tenantId_employeeId_startDate_idx" ON "HrLeaveRequest"("tenantId", "employeeId", "startDate");
ALTER TABLE "HrLeaveRequest" ADD CONSTRAINT "HrLeaveRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrLeaveRequest" ADD CONSTRAINT "HrLeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrLeaveRequest" ADD CONSTRAINT "HrLeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "HrLeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HrLeaveRequest" ADD CONSTRAINT "HrLeaveRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "HrHoliday" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "name" TEXT NOT NULL, "holidayDate" TIMESTAMP(3) NOT NULL,
  "confirmed" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrHoliday_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrHoliday_tenantId_holidayDate_name_key" ON "HrHoliday"("tenantId", "holidayDate", "name");
CREATE INDEX "HrHoliday_tenantId_holidayDate_idx" ON "HrHoliday"("tenantId", "holidayDate");
ALTER TABLE "HrHoliday" ADD CONSTRAINT "HrHoliday_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HrEmployeeDocument" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "kind" TEXT NOT NULL, "name" TEXT NOT NULL,
  "storageKey" TEXT, "expiresAt" TIMESTAMP(3), "verifiedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEmployeeDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrEmployeeDocument_tenantId_employeeId_kind_idx" ON "HrEmployeeDocument"("tenantId", "employeeId", "kind");
ALTER TABLE "HrEmployeeDocument" ADD CONSTRAINT "HrEmployeeDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrEmployeeDocument" ADD CONSTRAINT "HrEmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BiometricConsent" (
  "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "grantedAt" TIMESTAMP(3),
  "withdrawnAt" TIMESTAMP(3), "policyVersion" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BiometricConsent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BiometricConsent_tenantId_employeeId_idx" ON "BiometricConsent"("tenantId", "employeeId");
ALTER TABLE "BiometricConsent" ADD CONSTRAINT "BiometricConsent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BiometricConsent" ADD CONSTRAINT "BiometricConsent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Non-BYPASSRLS group role used by deployment runtime credentials.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'master_saas_app') THEN
    CREATE ROLE master_saas_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO master_saas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO master_saas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO master_saas_app;

-- RLS is active for the shared HR tables and the core Sales tables. The policy
-- fails closed unless app.tenant_id is set by the request transaction.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Department','Designation','EmployeeProfile','MembershipRole','HrShift','HrEmployeeShift',
    'HrAttendanceRecord','HrLeaveType','HrLeaveRequest','HrHoliday','HrEmployeeDocument',
    'HrWorkLocation','BiometricConsent','WorkspaceUsage','BillingEvent',
    'Lead','LeadStage','Account','Contact','Opportunity','Pipeline','PipelineStage','Activity','Task','Call','Campaign'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO master_saas_app USING ("tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')) WITH CHECK ("tenantId" = nullif(current_setting(''app.tenant_id'', true), ''''))',
      table_name
    );
  END LOOP;
END $$;
