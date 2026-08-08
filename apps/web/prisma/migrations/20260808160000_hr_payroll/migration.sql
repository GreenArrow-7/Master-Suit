-- Payroll: effective-dated pay, maker-checker runs, payslips and WPS fields.
--
-- New product work, not a migration gap — the original HRMS had payroll
-- permissions and no payroll. `EmployeeProfile.basicSalary` already existed but
-- is mutable, so it cannot answer "what was this person earning in March";
-- HrCompensation is the history, and the profile columns stay as the
-- current-value convenience the gratuity calculation already reads.

-- ── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE "HrPayrollStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'LOCKED', 'PAID', 'CANCELLED');
CREATE TYPE "HrPayComponentKind" AS ENUM ('EARNING', 'DEDUCTION');

-- ── Where the salary is sent ────────────────────────────────────────────────
ALTER TABLE "EmployeeProfile" ADD COLUMN "iban" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "bankName" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "bankAgentId" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "wpsPersonId" TEXT;

-- ── Effective-dated compensation ────────────────────────────────────────────
CREATE TABLE "HrCompensation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "basic" DECIMAL(14,2) NOT NULL,
    "housing" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "transport" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherAllowance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "changeReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrCompensation_pkey" PRIMARY KEY ("id")
);

-- Two salaries starting the same day have no defined winner, and payroll would
-- silently pick one.
CREATE UNIQUE INDEX "HrCompensation_tenantId_employeeId_effectiveFrom_key"
    ON "HrCompensation"("tenantId", "employeeId", "effectiveFrom");
CREATE INDEX "HrCompensation_tenantId_employeeId_effectiveFrom_idx"
    ON "HrCompensation"("tenantId", "employeeId", "effectiveFrom");
ALTER TABLE "HrCompensation"
    ADD CONSTRAINT "HrCompensation_amounts_check"
    CHECK ("basic" > 0 AND "housing" >= 0 AND "transport" >= 0 AND "otherAllowance" >= 0);

ALTER TABLE "HrCompensation" ADD CONSTRAINT "HrCompensation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrCompensation" ADD CONSTRAINT "HrCompensation_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Runs ────────────────────────────────────────────────────────────────────
CREATE TABLE "HrPayrollRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "HrPayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "policySnapshot" JSONB,
    "note" TEXT,
    "grossTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "netTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "calculatedAt" TIMESTAMP(3),
    "preparedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrPayrollRun_pkey" PRIMARY KEY ("id")
);

-- One run per period. Paying March twice is the failure this prevents.
CREATE UNIQUE INDEX "HrPayrollRun_tenantId_periodStart_periodEnd_key"
    ON "HrPayrollRun"("tenantId", "periodStart", "periodEnd");
CREATE INDEX "HrPayrollRun_tenantId_status_periodStart_idx"
    ON "HrPayrollRun"("tenantId", "status", "periodStart");
ALTER TABLE "HrPayrollRun"
    ADD CONSTRAINT "HrPayrollRun_period_check" CHECK ("periodEnd" >= "periodStart");

ALTER TABLE "HrPayrollRun" ADD CONSTRAINT "HrPayrollRun_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrPayrollRun" ADD CONSTRAINT "HrPayrollRun_preparedById_fkey"
    FOREIGN KEY ("preparedById") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HrPayrollRun" ADD CONSTRAINT "HrPayrollRun_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Payslips ────────────────────────────────────────────────────────────────
CREATE TABLE "HrPayslip" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "basic" DECIMAL(14,2) NOT NULL,
    "grossEarnings" DECIMAL(14,2) NOT NULL,
    "totalDeductions" DECIMAL(14,2) NOT NULL,
    "netPay" DECIMAL(14,2) NOT NULL,
    "workedDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unpaidDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "inputs" JSONB NOT NULL,
    "ibanSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrPayslip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HrPayslip_tenantId_runId_employeeId_key"
    ON "HrPayslip"("tenantId", "runId", "employeeId");
CREATE INDEX "HrPayslip_tenantId_employeeId_idx" ON "HrPayslip"("tenantId", "employeeId");
-- A negative payslip means the company is invoicing the employee, which is a
-- recovery process, not a salary transfer.
ALTER TABLE "HrPayslip" ADD CONSTRAINT "HrPayslip_netPay_check" CHECK ("netPay" >= 0);

ALTER TABLE "HrPayslip" ADD CONSTRAINT "HrPayslip_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrPayslip" ADD CONSTRAINT "HrPayslip_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "HrPayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrPayslip" ADD CONSTRAINT "HrPayslip_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HrPayslipLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "HrPayComponentKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "HrPayslipLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HrPayslipLine_tenantId_payslipId_idx" ON "HrPayslipLine"("tenantId", "payslipId");
ALTER TABLE "HrPayslipLine" ADD CONSTRAINT "HrPayslipLine_payslipId_fkey"
    FOREIGN KEY ("payslipId") REFERENCES "HrPayslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── One-off money ───────────────────────────────────────────────────────────
CREATE TABLE "HrPayrollAdjustment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveOn" TIMESTAMP(3) NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "HrPayComponentKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT,
    "consumedByRunId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrPayrollAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HrPayrollAdjustment_tenantId_employeeId_effectiveOn_idx"
    ON "HrPayrollAdjustment"("tenantId", "employeeId", "effectiveOn");
CREATE INDEX "HrPayrollAdjustment_tenantId_consumedByRunId_idx"
    ON "HrPayrollAdjustment"("tenantId", "consumedByRunId");
ALTER TABLE "HrPayrollAdjustment"
    ADD CONSTRAINT "HrPayrollAdjustment_amount_check" CHECK ("amount" > 0);

ALTER TABLE "HrPayrollAdjustment" ADD CONSTRAINT "HrPayrollAdjustment_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrPayrollAdjustment" ADD CONSTRAINT "HrPayrollAdjustment_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Permissions ─────────────────────────────────────────────────────────────
-- `payroll` already existed as a dead permission in the original catalogue. It
-- now has endpoints behind it.
--
-- Nothing is backfilled. Every other HR permission in this schema was derived
-- from one a role already held, because the authority already existed under a
-- coarser name — but nobody has ever been able to read salaries here, so there
-- is no prior grant to derive from, and inventing one would hand payroll access
-- to whoever happens to administer HR. §90 says the opposite: HR and payroll
-- stay separable. A workspace grants these deliberately, in the roles screen.
INSERT INTO "Permission" ("id", "module", "action", "description")
VALUES
  (gen_random_uuid()::text, 'payroll', 'VIEW',    'Read payroll runs, payslips and compensation for other people'),
  (gen_random_uuid()::text, 'payroll', 'CREATE',  'Open a payroll run'),
  (gen_random_uuid()::text, 'payroll', 'EDIT',    'Enter compensation and adjustments, and calculate a run'),
  (gen_random_uuid()::text, 'payroll', 'APPROVE', 'Approve, lock and settle a payroll run'),
  (gen_random_uuid()::text, 'payroll', 'EXPORT',  'Generate the WPS salary file')
ON CONFLICT ("module", "action") DO NOTHING;

-- ── Row-level security ──────────────────────────────────────────────────────
-- Scoped to the tables this migration creates. See the note in
-- 20260808140000_hr_overtime: re-running the catalog-wide sweep from a stale
-- copy silently downgrades every other table's policy.
GRANT SELECT, INSERT, UPDATE, DELETE ON
    "HrCompensation", "HrPayrollRun", "HrPayslip", "HrPayslipLine", "HrPayrollAdjustment"
    TO master_saas_app;

DO $$
DECLARE
  target TEXT;
BEGIN
  -- HrPayslipLine carries no tenantId of its own in the isolation sense: it is
  -- reached only through its payslip. It has the column, so it joins the regime
  -- like everything else.
  FOREACH target IN ARRAY ARRAY['HrCompensation', 'HrPayrollRun', 'HrPayslip', 'HrPayslipLine', 'HrPayrollAdjustment']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING ('
      '  "tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')'
      '  OR current_setting(''app.platform_admin'', true) = ''on'''
      ') '
      'WITH CHECK ('
      '  "tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')'
      '  OR current_setting(''app.platform_admin'', true) = ''on'''
      ')',
      target
    );
  END LOOP;
END $$;
