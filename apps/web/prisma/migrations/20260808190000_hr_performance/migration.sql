-- Performance: cycles, goals, reviews, competencies and improvement plans.
--
-- The ordering in HrReviewStatus is the module's whole design: the employee
-- writes first so the manager's rating is informed by it, and the employee
-- acknowledges last so nothing is closed behind their back.

CREATE TYPE "HrCycleType" AS ENUM ('ANNUAL', 'SEMIANNUAL', 'QUARTERLY', 'PROBATION', 'CUSTOM');
CREATE TYPE "HrCycleStatus" AS ENUM ('DRAFT', 'OPEN', 'CALIBRATION', 'CLOSED');
CREATE TYPE "HrReviewStatus" AS ENUM (
  'PENDING_SELF', 'PENDING_MANAGER', 'CALIBRATION', 'AWAITING_ACKNOWLEDGEMENT', 'COMPLETE'
);
CREATE TYPE "HrGoalStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ACHIEVED', 'MISSED', 'CANCELLED');
CREATE TYPE "HrPipStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED_SUCCESS', 'COMPLETED_FAILED', 'CANCELLED');

CREATE TABLE "HrReviewCycle" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HrCycleType" NOT NULL DEFAULT 'ANNUAL',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "selfReviewDueAt" TIMESTAMP(3),
    "managerReviewDueAt" TIMESTAMP(3),
    "status" "HrCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrReviewCycle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrReviewCycle_tenantId_name_key" ON "HrReviewCycle"("tenantId", "name");
CREATE INDEX "HrReviewCycle_tenantId_status_periodStart_idx" ON "HrReviewCycle"("tenantId", "status", "periodStart");
ALTER TABLE "HrReviewCycle" ADD CONSTRAINT "HrReviewCycle_period_check" CHECK ("periodEnd" >= "periodStart");
ALTER TABLE "HrReviewCycle" ADD CONSTRAINT "HrReviewCycle_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HrGoal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "cycleId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metric" TEXT,
    "target" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "dueOn" TIMESTAMP(3),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "status" "HrGoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "evidence" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrGoal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrGoal_tenantId_employeeId_cycleId_idx" ON "HrGoal"("tenantId", "employeeId", "cycleId");
ALTER TABLE "HrGoal" ADD CONSTRAINT "HrGoal_weight_check" CHECK ("weight" BETWEEN 0 AND 100);
ALTER TABLE "HrGoal" ADD CONSTRAINT "HrGoal_progress_check" CHECK ("progress" BETWEEN 0 AND 100);
ALTER TABLE "HrGoal" ADD CONSTRAINT "HrGoal_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrGoal" ADD CONSTRAINT "HrGoal_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrGoal" ADD CONSTRAINT "HrGoal_cycleId_fkey"
    FOREIGN KEY ("cycleId") REFERENCES "HrReviewCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "HrCompetency" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrCompetency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrCompetency_tenantId_name_key" ON "HrCompetency"("tenantId", "name");
ALTER TABLE "HrCompetency" ADD CONSTRAINT "HrCompetency_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HrReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "managerId" TEXT,
    "status" "HrReviewStatus" NOT NULL DEFAULT 'PENDING_SELF',
    "selfComments" TEXT,
    "selfRating" INTEGER,
    "selfSubmittedAt" TIMESTAMP(3),
    "managerComments" TEXT,
    "managerRating" INTEGER,
    "managerSubmittedAt" TIMESTAMP(3),
    "finalRating" INTEGER,
    "calibratedById" TEXT,
    "calibratedAt" TIMESTAMP(3),
    "calibrationNote" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgementNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrReview_pkey" PRIMARY KEY ("id")
);
-- One review per person per cycle.
CREATE UNIQUE INDEX "HrReview_tenantId_cycleId_employeeId_key" ON "HrReview"("tenantId", "cycleId", "employeeId");
CREATE INDEX "HrReview_tenantId_status_idx" ON "HrReview"("tenantId", "status");
CREATE INDEX "HrReview_tenantId_employeeId_idx" ON "HrReview"("tenantId", "employeeId");
ALTER TABLE "HrReview" ADD CONSTRAINT "HrReview_ratings_check" CHECK (
  ("selfRating" IS NULL OR "selfRating" BETWEEN 1 AND 5)
  AND ("managerRating" IS NULL OR "managerRating" BETWEEN 1 AND 5)
  AND ("finalRating" IS NULL OR "finalRating" BETWEEN 1 AND 5)
);
ALTER TABLE "HrReview" ADD CONSTRAINT "HrReview_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrReview" ADD CONSTRAINT "HrReview_cycleId_fkey"
    FOREIGN KEY ("cycleId") REFERENCES "HrReviewCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrReview" ADD CONSTRAINT "HrReview_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrReview" ADD CONSTRAINT "HrReview_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HrReview" ADD CONSTRAINT "HrReview_calibratedById_fkey"
    FOREIGN KEY ("calibratedById") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "HrReviewCompetencyScore" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "selfScore" INTEGER,
    "managerScore" INTEGER,
    "comment" TEXT,
    CONSTRAINT "HrReviewCompetencyScore_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HrReviewCompetencyScore_tenantId_reviewId_competencyId_key"
    ON "HrReviewCompetencyScore"("tenantId", "reviewId", "competencyId");
ALTER TABLE "HrReviewCompetencyScore" ADD CONSTRAINT "HrReviewCompetencyScore_scores_check" CHECK (
  ("selfScore" IS NULL OR "selfScore" BETWEEN 1 AND 5)
  AND ("managerScore" IS NULL OR "managerScore" BETWEEN 1 AND 5)
);
ALTER TABLE "HrReviewCompetencyScore" ADD CONSTRAINT "HrReviewCompetencyScore_reviewId_fkey"
    FOREIGN KEY ("reviewId") REFERENCES "HrReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrReviewCompetencyScore" ADD CONSTRAINT "HrReviewCompetencyScore_competencyId_fkey"
    FOREIGN KEY ("competencyId") REFERENCES "HrCompetency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HrPip" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "managerId" TEXT,
    "objective" TEXT NOT NULL,
    "expectedImprovements" TEXT NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3) NOT NULL,
    "status" "HrPipStatus" NOT NULL DEFAULT 'DRAFT',
    "outcome" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgementNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrPip_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrPip_tenantId_status_idx" ON "HrPip"("tenantId", "status");
CREATE INDEX "HrPip_tenantId_employeeId_idx" ON "HrPip"("tenantId", "employeeId");
ALTER TABLE "HrPip" ADD CONSTRAINT "HrPip_period_check" CHECK ("endsOn" > "startsOn");
ALTER TABLE "HrPip" ADD CONSTRAINT "HrPip_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrPip" ADD CONSTRAINT "HrPip_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrPip" ADD CONSTRAINT "HrPip_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "HrPipCheckpoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pipId" TEXT NOT NULL,
    "dueOn" TIMESTAMP(3) NOT NULL,
    "expectation" TEXT NOT NULL,
    "managerComment" TEXT,
    "met" BOOLEAN,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrPipCheckpoint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrPipCheckpoint_tenantId_pipId_dueOn_idx" ON "HrPipCheckpoint"("tenantId", "pipId", "dueOn");
ALTER TABLE "HrPipCheckpoint" ADD CONSTRAINT "HrPipCheckpoint_pipId_fkey"
    FOREIGN KEY ("pipId") REFERENCES "HrPip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Permissions ─────────────────────────────────────────────────────────────
-- Granted to nobody, like `payroll` and `recruitment`. Performance data decides
-- promotions and is quoted in disputes; it is not something to inherit from
-- whoever happens to administer HR.
INSERT INTO "Permission" ("id", "module", "action", "description")
VALUES
  (gen_random_uuid()::text, 'performance', 'VIEW',    'Read performance records beyond your own reporting line'),
  (gen_random_uuid()::text, 'performance', 'CREATE',  'Create goals and improvement plans'),
  (gen_random_uuid()::text, 'performance', 'EDIT',    'Write reviews and update goals'),
  (gen_random_uuid()::text, 'performance', 'APPROVE', 'Run review cycles and calibrate final ratings')
ON CONFLICT ("module", "action") DO NOTHING;

-- ── Row-level security ──────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON
    "HrReviewCycle", "HrGoal", "HrCompetency", "HrReview", "HrReviewCompetencyScore", "HrPip", "HrPipCheckpoint"
    TO master_saas_app;

DO $$
DECLARE
  target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'HrReviewCycle', 'HrGoal', 'HrCompetency', 'HrReview', 'HrReviewCompetencyScore', 'HrPip', 'HrPipCheckpoint'
  ]
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
