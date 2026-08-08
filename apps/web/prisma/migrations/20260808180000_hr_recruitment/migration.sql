-- Applicant tracking, ending in an employee.
--
-- `recruitment.manage` was a permission with nothing behind it. This is the
-- module, and its point is the last step: a hire issues an invitation whose
-- acceptance creates an employee record carrying `hiredFromCandidateId`, so the
-- chain from requisition to onboarding stays traceable (§109).

CREATE TYPE "HrRequisitionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'OPEN', 'ON_HOLD', 'CLOSED', 'REJECTED');
CREATE TYPE "HrCandidateStage" AS ENUM (
  'APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'ASSESSMENT',
  'FINAL_INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN', 'ON_HOLD'
);
CREATE TYPE "HrInterviewType" AS ENUM ('PHONE', 'VIDEO', 'ONSITE', 'PANEL', 'TECHNICAL');
CREATE TYPE "HrInterviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "HrRecommendation" AS ENUM ('STRONG_YES', 'YES', 'NEUTRAL', 'NO', 'STRONG_NO');
CREATE TYPE "HrOfferStatus" AS ENUM (
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'
);

-- ── Requisitions ────────────────────────────────────────────────────────────
CREATE TABLE "HrRequisition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" TEXT,
    "hiringManagerId" TEXT,
    "recruiterId" TEXT,
    "openings" INTEGER NOT NULL DEFAULT 1,
    "employmentType" TEXT,
    "locationId" TEXT,
    "salaryMin" DECIMAL(14,2),
    "salaryMax" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "description" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "status" "HrRequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrRequisition_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrRequisition_tenantId_status_createdAt_idx" ON "HrRequisition"("tenantId", "status", "createdAt");
ALTER TABLE "HrRequisition" ADD CONSTRAINT "HrRequisition_openings_check" CHECK ("openings" >= 1);
ALTER TABLE "HrRequisition" ADD CONSTRAINT "HrRequisition_band_check"
    CHECK ("salaryMin" IS NULL OR "salaryMax" IS NULL OR "salaryMax" >= "salaryMin");

ALTER TABLE "HrRequisition" ADD CONSTRAINT "HrRequisition_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrRequisition" ADD CONSTRAINT "HrRequisition_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HrRequisition" ADD CONSTRAINT "HrRequisition_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "HrWorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HrRequisition" ADD CONSTRAINT "HrRequisition_hiringManagerId_fkey"
    FOREIGN KEY ("hiringManagerId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HrRequisition" ADD CONSTRAINT "HrRequisition_recruiterId_fkey"
    FOREIGN KEY ("recruiterId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HrRequisition" ADD CONSTRAINT "HrRequisition_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Candidates ──────────────────────────────────────────────────────────────
CREATE TABLE "HrCandidate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "source" TEXT,
    "experienceYears" DOUBLE PRECISION,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resumeDocumentId" TEXT,
    "notes" TEXT,
    "stage" "HrCandidateStage" NOT NULL DEFAULT 'APPLIED',
    "rejectionReason" TEXT,
    "invitationId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrCandidate_pkey" PRIMARY KEY ("id")
);

-- Nobody applies to the same requisition twice.
CREATE UNIQUE INDEX "HrCandidate_tenantId_requisitionId_email_key"
    ON "HrCandidate"("tenantId", "requisitionId", "email");
CREATE INDEX "HrCandidate_tenantId_stage_idx" ON "HrCandidate"("tenantId", "stage");
CREATE INDEX "HrCandidate_tenantId_requisitionId_stage_idx" ON "HrCandidate"("tenantId", "requisitionId", "stage");

ALTER TABLE "HrCandidate" ADD CONSTRAINT "HrCandidate_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrCandidate" ADD CONSTRAINT "HrCandidate_requisitionId_fkey"
    FOREIGN KEY ("requisitionId") REFERENCES "HrRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HrCandidateStageEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "fromStage" "HrCandidateStage",
    "toStage" "HrCandidateStage" NOT NULL,
    "note" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrCandidateStageEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrCandidateStageEvent_tenantId_candidateId_createdAt_idx"
    ON "HrCandidateStageEvent"("tenantId", "candidateId", "createdAt");
ALTER TABLE "HrCandidateStageEvent" ADD CONSTRAINT "HrCandidateStageEvent_candidateId_fkey"
    FOREIGN KEY ("candidateId") REFERENCES "HrCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Interviews ──────────────────────────────────────────────────────────────
CREATE TABLE "HrInterview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "type" "HrInterviewType" NOT NULL DEFAULT 'VIDEO',
    "status" "HrInterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "location" TEXT,
    "panelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrInterview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HrInterview_tenantId_scheduledAt_idx" ON "HrInterview"("tenantId", "scheduledAt");
CREATE INDEX "HrInterview_tenantId_candidateId_idx" ON "HrInterview"("tenantId", "candidateId");
ALTER TABLE "HrInterview" ADD CONSTRAINT "HrInterview_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrInterview" ADD CONSTRAINT "HrInterview_candidateId_fkey"
    FOREIGN KEY ("candidateId") REFERENCES "HrCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HrInterviewFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "interviewerId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "recommendation" "HrRecommendation" NOT NULL,
    "scores" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrInterviewFeedback_pkey" PRIMARY KEY ("id")
);
-- One scorecard per interviewer per interview; a second submission edits the first.
CREATE UNIQUE INDEX "HrInterviewFeedback_tenantId_interviewId_interviewerId_key"
    ON "HrInterviewFeedback"("tenantId", "interviewId", "interviewerId");
CREATE INDEX "HrInterviewFeedback_tenantId_interviewId_idx" ON "HrInterviewFeedback"("tenantId", "interviewId");
ALTER TABLE "HrInterviewFeedback" ADD CONSTRAINT "HrInterviewFeedback_rating_check"
    CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "HrInterviewFeedback" ADD CONSTRAINT "HrInterviewFeedback_interviewId_fkey"
    FOREIGN KEY ("interviewId") REFERENCES "HrInterview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrInterviewFeedback" ADD CONSTRAINT "HrInterviewFeedback_interviewerId_fkey"
    FOREIGN KEY ("interviewerId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Offers ──────────────────────────────────────────────────────────────────
CREATE TABLE "HrOffer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "basic" DECIMAL(14,2) NOT NULL,
    "housing" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "transport" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherAllowance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "joiningDate" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "status" "HrOfferStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrOffer_pkey" PRIMARY KEY ("id")
);
-- Versioned by row: a renegotiated offer is a new version, never an edit.
CREATE UNIQUE INDEX "HrOffer_tenantId_candidateId_version_key" ON "HrOffer"("tenantId", "candidateId", "version");
CREATE INDEX "HrOffer_tenantId_status_idx" ON "HrOffer"("tenantId", "status");
ALTER TABLE "HrOffer" ADD CONSTRAINT "HrOffer_basic_check" CHECK ("basic" > 0);
ALTER TABLE "HrOffer" ADD CONSTRAINT "HrOffer_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrOffer" ADD CONSTRAINT "HrOffer_candidateId_fkey"
    FOREIGN KEY ("candidateId") REFERENCES "HrCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrOffer" ADD CONSTRAINT "HrOffer_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── The traceability link (§109) ────────────────────────────────────────────
ALTER TABLE "EmployeeProfile" ADD COLUMN "hiredFromCandidateId" TEXT;
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_hiredFromCandidateId_fkey"
    FOREIGN KEY ("hiredFromCandidateId") REFERENCES "HrCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Carried on the invitation so the employee created at acceptance can point back
-- at the application, and can date from the agreed start rather than from
-- whenever the person happened to click the link.
ALTER TABLE "WorkspaceInvitation" ADD COLUMN "candidateId" TEXT;
ALTER TABLE "WorkspaceInvitation" ADD COLUMN "joiningDate" TIMESTAMP(3);

-- ── Permissions ─────────────────────────────────────────────────────────────
-- `recruitment` was in the original catalogue with nothing behind it. Like
-- `payroll`, it is granted to nobody: there is no coarser authority to derive
-- from, and salary bands are visible through it, so a workspace grants it
-- deliberately rather than inheriting it from whoever administers HR.
INSERT INTO "Permission" ("id", "module", "action", "description")
VALUES
  (gen_random_uuid()::text, 'recruitment', 'VIEW',    'Read requisitions, candidates and the pipeline'),
  (gen_random_uuid()::text, 'recruitment', 'CREATE',  'Raise a requisition'),
  (gen_random_uuid()::text, 'recruitment', 'EDIT',    'Manage candidates, interviews and offers'),
  (gen_random_uuid()::text, 'recruitment', 'DELETE',  'Remove recruitment records'),
  (gen_random_uuid()::text, 'recruitment', 'APPROVE', 'Approve requisitions and offers'),
  (gen_random_uuid()::text, 'recruitment', 'VIEW_SENSITIVE_FIELDS', 'Read salary bands and offered compensation')
ON CONFLICT ("module", "action") DO NOTHING;

-- ── Row-level security ──────────────────────────────────────────────────────
-- Scoped to the tables created here. See 20260808140000_hr_overtime for why the
-- catalog-wide sweep must not be copied into a new migration.
GRANT SELECT, INSERT, UPDATE, DELETE ON
    "HrRequisition", "HrCandidate", "HrCandidateStageEvent", "HrInterview", "HrInterviewFeedback", "HrOffer"
    TO master_saas_app;

DO $$
DECLARE
  target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'HrRequisition', 'HrCandidate', 'HrCandidateStageEvent', 'HrInterview', 'HrInterviewFeedback', 'HrOffer'
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
