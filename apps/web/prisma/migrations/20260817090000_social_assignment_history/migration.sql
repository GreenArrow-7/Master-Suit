-- Why a social enquiry changed hands.
--
-- Separate from LeadAssignmentHistory because that model is Lead-shaped: its
-- leadId is a non-null foreign key, and a social enquiry has no Lead until
-- somebody converts it. Reusing it would mean creating the very CRM record the
-- two-layer design exists to withhold.

CREATE TYPE "SocialAssignmentSource" AS ENUM (
  'INHERITED_CUSTOMER_OWNER', 'EXPLICIT_USER', 'TEAM_DISTRIBUTION', 'GLOBAL_DISTRIBUTION', 'MANUAL', 'SYSTEM'
);

CREATE TABLE "SocialAssignmentHistory" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "socialCommentId" TEXT NOT NULL,
  "fromOwnerId"     TEXT,
  "toOwnerId"       TEXT,
  "teamId"          TEXT,
  "source"          "SocialAssignmentSource" NOT NULL,
  "method"          "DistributionMethod",
  "ruleId"          TEXT,
  "reason"          TEXT,
  "assignedById"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialAssignmentHistory_pkey" PRIMARY KEY ("id")
);

-- MANUAL is sticky: reprocessing must not undo a manager's deliberate choice.
ALTER TABLE "SocialComment" ADD COLUMN "assignmentSource" "SocialAssignmentSource";
ALTER TABLE "SocialComment" ADD COLUMN "assignedAt" TIMESTAMP(3);
-- Why nobody owns it, when nobody does. Surfaced in the unassigned queue, where
-- "No eligible members in Dubai Sales" is actionable and a null owner is not.
ALTER TABLE "SocialComment" ADD COLUMN "assignmentNote" TEXT;

CREATE INDEX "SocialAssignmentHistory_tenantId_socialCommentId_createdAt_idx"
  ON "SocialAssignmentHistory"("tenantId", "socialCommentId", "createdAt");
-- Time-to-assignment and per-salesperson volume both read this way.
CREATE INDEX "SocialAssignmentHistory_tenantId_toOwnerId_createdAt_idx"
  ON "SocialAssignmentHistory"("tenantId", "toOwnerId", "createdAt");

ALTER TABLE "SocialAssignmentHistory" ADD CONSTRAINT "SocialAssignmentHistory_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocialAssignmentHistory" ADD CONSTRAINT "SocialAssignmentHistory_socialCommentId_fkey"
  FOREIGN KEY ("socialCommentId") REFERENCES "SocialComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE
  target TEXT;
  covered CONSTANT TEXT[] := ARRAY['SocialAssignmentHistory'];
BEGIN
  FOREACH target IN ARRAY covered LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO master_saas_app', target);
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
