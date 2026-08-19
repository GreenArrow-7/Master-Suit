-- Layer 1 of the social-lead model: a captured Facebook or Instagram comment.
--
-- Deliberately NOT a Lead. A post attracts "Beautiful" alongside "what's the
-- payment plan?", and only the second is a customer. Everything supported lands
-- here; a CRM Lead is created only on conversion or an explicit policy.

CREATE TYPE "SocialCommentStatus" AS ENUM (
  'NEW', 'REVIEWED', 'ASSIGNED', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'DISMISSED', 'SPAM'
);
CREATE TYPE "SocialIntent" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'IRRELEVANT', 'SPAM', 'UNSCORED');

CREATE TABLE "SocialComment" (
  "id"                      TEXT NOT NULL,
  "tenantId"                TEXT NOT NULL,
  "integrationConnectionId" TEXT,
  "provider"                TEXT NOT NULL,
  "providerCommentId"       TEXT NOT NULL,
  "providerAuthorId"        TEXT,
  "authorName"              TEXT,
  "commentText"             TEXT NOT NULL,
  "commentCreatedAt"        TIMESTAMP(3) NOT NULL,
  "providerMediaId"         TEXT,
  "mediaType"               TEXT,
  "mediaPermalink"          TEXT,
  "parentCommentId"         TEXT,
  "providerAdId"            TEXT,
  "providerAdTitle"         TEXT,
  "status"                  "SocialCommentStatus" NOT NULL DEFAULT 'NEW',
  "intent"                  "SocialIntent" NOT NULL DEFAULT 'UNSCORED',
  "intentScore"             INTEGER,
  "intentReasons"           TEXT[] DEFAULT ARRAY[]::TEXT[],
  "aiQualified"             BOOLEAN NOT NULL DEFAULT false,
  "ownerId"                 TEXT,
  "teamId"                  TEXT,
  "linkedLeadId"            TEXT,
  "linkedContactId"         TEXT,
  "repliedAt"               TIMESTAMP(3),
  "providerReplyId"         TEXT,
  "convertedAt"             TIMESTAMP(3),
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SocialComment_pkey" PRIMARY KEY ("id")
);

-- The idempotency key. Provider is part of it because Facebook and Instagram
-- mint comment ids in separate spaces, so the pair is what identifies a comment.
-- Meta redelivers; this is what makes one comment stay one row.
CREATE UNIQUE INDEX "SocialComment_tenantId_provider_providerCommentId_key"
  ON "SocialComment"("tenantId", "provider", "providerCommentId");

-- The queue view: newest first, filtered by status and intent.
CREATE INDEX "SocialComment_tenantId_status_commentCreatedAt_idx"
  ON "SocialComment"("tenantId", "status", "commentCreatedAt" DESC);
CREATE INDEX "SocialComment_tenantId_intent_status_idx" ON "SocialComment"("tenantId", "intent", "status");
CREATE INDEX "SocialComment_tenantId_ownerId_status_idx" ON "SocialComment"("tenantId", "ownerId", "status");
-- "Which post produced enquiries" — the attribution question this feature exists for.
CREATE INDEX "SocialComment_tenantId_providerMediaId_idx" ON "SocialComment"("tenantId", "providerMediaId");
-- Recognising a returning commenter without relying on a username, which changes.
CREATE INDEX "SocialComment_tenantId_provider_providerAuthorId_idx"
  ON "SocialComment"("tenantId", "provider", "providerAuthorId");

ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL throughout: losing an owner, a team or a converted lead must not
-- delete the record of the enquiry ever having arrived.
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_linkedLeadId_fkey"
  FOREIGN KEY ("linkedLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Layer 3 of the tenant defence. Without FORCE the owning role reads every
-- tenant's social enquiries regardless of policy, and lib/startup-check.ts
-- refuses to boot on exactly that condition.
DO $$
DECLARE
  target TEXT;
  covered CONSTANT TEXT[] := ARRAY['SocialComment'];
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
