-- Conversation Intelligence.
--
-- Additive on top of the call-intelligence tables that already exist. Recording
-- holds the audio, Transcript the text, AIAnalysis the structured insight and
-- CallAudit the scorecard result; none of them are replaced here. What is added
-- is the three things they had nowhere to put:
--
--   * the workspace's objection playbook, and what it matched in a call
--   * a rep practising against it, and how that went
--   * a manager writing to the rep about a real call
--
-- Every new table is tenant-scoped and carries the same three-layer defence as
-- the rest of the schema: an explicit tenantId in every query, the tenant guard
-- in src/lib/db.ts, and the RLS policy at the bottom of this file.

-- ── Columns on existing tables ──────────────────────────────────────────────

-- Speaker-attributed segments from a diarising provider. The flat `content`
-- stays authoritative; this is a second view of the same audio, and empty when
-- the provider does not diarise.
ALTER TABLE "Transcript" ADD COLUMN "segments" JSONB NOT NULL DEFAULT '[]';

-- `talkRatio` is computed from the transcript, not asked of the model: a number
-- a model guesses at is not a measurement, and a manager will read it as one.
ALTER TABLE "AIAnalysis" ADD COLUMN "actionItems"   JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "AIAnalysis" ADD COLUMN "talkRatio"     DOUBLE PRECISION;
ALTER TABLE "AIAnalysis" ADD COLUMN "promptVersion" TEXT;

-- Roleplay is a billed model call per turn, so the cap is spend control. 0 off.
ALTER TABLE "OrganizationSetting" ADD COLUMN "practiceDailyCap" INTEGER NOT NULL DEFAULT 10;

-- ── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE "PracticeScenario" AS ENUM ('OPENER', 'DISCOVERY', 'OBJECTION', 'CLOSE');
CREATE TYPE "PracticeStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- ── Objection playbook ──────────────────────────────────────────────────────

CREATE TABLE "Objection" (
  "id"                   TEXT NOT NULL,
  "tenantId"             TEXT NOT NULL,
  "name"                 TEXT NOT NULL,
  "description"          TEXT,
  "tags"                 TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "triggerPhrases"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "recommendedResponses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isActive"             BOOLEAN NOT NULL DEFAULT true,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  "createdById"          TEXT,
  "updatedById"          TEXT,
  "deletedAt"            TIMESTAMP(3),
  CONSTRAINT "Objection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Objection_tenantId_name_key" ON "Objection"("tenantId", "name");
CREATE INDEX "Objection_tenantId_isActive_idx" ON "Objection"("tenantId", "isActive");

CREATE TABLE "ObjectionMatch" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "callId"      TEXT NOT NULL,
  "objectionId" TEXT NOT NULL,
  "phrase"      TEXT NOT NULL,
  "snippet"     TEXT NOT NULL,
  "addressed"   BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObjectionMatch_pkey" PRIMARY KEY ("id")
);

-- The idempotency key. An analysis re-run rewrites a call's matches, and this
-- stops a concurrent re-run stacking a second copy of the same finding.
CREATE UNIQUE INDEX "ObjectionMatch_tenantId_callId_objectionId_phrase_key"
  ON "ObjectionMatch"("tenantId", "callId", "objectionId", "phrase");
CREATE INDEX "ObjectionMatch_tenantId_callId_idx" ON "ObjectionMatch"("tenantId", "callId");
CREATE INDEX "ObjectionMatch_tenantId_objectionId_idx" ON "ObjectionMatch"("tenantId", "objectionId");

-- ── Roleplay practice ───────────────────────────────────────────────────────

CREATE TABLE "PracticeSession" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "scenario"    "PracticeScenario" NOT NULL,
  "objectionId" TEXT,
  "brief"       TEXT NOT NULL,
  "turns"       JSONB NOT NULL DEFAULT '[]',
  "status"      "PracticeStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "startedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PracticeSession_pkey" PRIMARY KEY ("id")
);

-- Backs both the rep's own history and the daily-cap count, which asks for one
-- rep's sessions since midnight.
CREATE INDEX "PracticeSession_tenantId_userId_startedAt_idx"
  ON "PracticeSession"("tenantId", "userId", "startedAt" DESC);
CREATE INDEX "PracticeSession_tenantId_scenario_startedAt_idx"
  ON "PracticeSession"("tenantId", "scenario", "startedAt" DESC);

CREATE TABLE "PracticeScore" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "sessionId"    TEXT NOT NULL,
  "status"       "AnalysisStatus" NOT NULL DEFAULT 'PENDING',
  "overallScore" DOUBLE PRECISION,
  "maxScore"     DOUBLE PRECISION,
  "rubricScores" JSONB NOT NULL DEFAULT '[]',
  "strengths"    JSONB NOT NULL DEFAULT '[]',
  "improvements" JSONB NOT NULL DEFAULT '[]',
  "modelId"      TEXT,
  "errorMessage" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PracticeScore_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PracticeScore_sessionId_key" ON "PracticeScore"("sessionId");
CREATE INDEX "PracticeScore_tenantId_status_idx" ON "PracticeScore"("tenantId", "status");

-- ── Manager coaching ────────────────────────────────────────────────────────

CREATE TABLE "CoachingNote" (
  "id"         TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL,
  "callId"     TEXT NOT NULL,
  "authorId"   TEXT NOT NULL,
  "body"       TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  "deletedAt"  TIMESTAMP(3),
  CONSTRAINT "CoachingNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CoachingNote_tenantId_callId_createdAt_idx"
  ON "CoachingNote"("tenantId", "callId", "createdAt" DESC);
CREATE INDEX "CoachingNote_tenantId_authorId_idx" ON "CoachingNote"("tenantId", "authorId");

-- ── Foreign keys ────────────────────────────────────────────────────────────

ALTER TABLE "Objection" ADD CONSTRAINT "Objection_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ObjectionMatch" ADD CONSTRAINT "ObjectionMatch_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ObjectionMatch" ADD CONSTRAINT "ObjectionMatch_callId_fkey"
  FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ObjectionMatch" ADD CONSTRAINT "ObjectionMatch_objectionId_fkey"
  FOREIGN KEY ("objectionId") REFERENCES "Objection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PracticeScore" ADD CONSTRAINT "PracticeScore_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeScore" ADD CONSTRAINT "PracticeScore_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "PracticeSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CoachingNote" ADD CONSTRAINT "CoachingNote_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachingNote" ADD CONSTRAINT "CoachingNote_callId_fkey"
  FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoachingNote" ADD CONSTRAINT "CoachingNote_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `PracticeSession.objectionId` is a scalar reference with no FK, matching the
-- schema's convention for links the application does not join through. It is
-- nullable, points at a soft-deletable row, and a playbook entry retired after a
-- session was practised must not cascade that session away.

-- ── Row-level security: layer 3 ─────────────────────────────────────────────
--
-- Named explicitly rather than by re-running the catalogue sweep, for the reason
-- recorded in 20260808140000_hr_overtime: a sweep carries a stale copy of the
-- bootstrap exclusion list. Five new tables need five policies.

DO $$
DECLARE
  target TEXT;
  covered CONSTANT TEXT[] := ARRAY[
    'Objection', 'ObjectionMatch', 'PracticeSession', 'PracticeScore', 'CoachingNote'
  ];
BEGIN
  FOREACH target IN ARRAY covered LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO master_saas_app', target);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    -- FORCE, because the migration role owns these tables and an owner bypasses
    -- RLS unconditionally without it. lib/startup-check.ts refuses to boot on
    -- exactly that condition.
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

-- `current_setting(..., true)` returns NULL rather than erroring on a connection
-- that never set it. NULL fails both branches, which is the fail-closed
-- direction: a query with no tenant context sees nothing at all.
