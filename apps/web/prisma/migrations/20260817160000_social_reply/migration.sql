-- Answers sent to social enquiries.
--
-- Append-only, alongside `SocialComment.repliedAt` rather than replacing it:
-- that field is the *first* response, which is what the SLA measures and what
-- spends Meta's single allowed private reply. A thread can carry several public
-- replies afterwards, and this is what makes "who actually answered, and how"
-- answerable later.

CREATE TYPE "SocialReplyKind" AS ENUM ('PUBLIC', 'PRIVATE', 'EXTERNAL');

CREATE TABLE "SocialReply" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "socialCommentId" TEXT NOT NULL,
  "kind"            "SocialReplyKind" NOT NULL,
  "channel"         TEXT,
  "body"            TEXT NOT NULL,
  "providerReplyId" TEXT,
  "delivered"       BOOLEAN NOT NULL DEFAULT true,
  "aiAssisted"      BOOLEAN NOT NULL DEFAULT false,
  "sentById"        TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SocialReply_tenantId_socialCommentId_createdAt_idx"
  ON "SocialReply"("tenantId", "socialCommentId", "createdAt");

ALTER TABLE "SocialReply" ADD CONSTRAINT "SocialReply_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocialReply" ADD CONSTRAINT "SocialReply_socialCommentId_fkey"
  FOREIGN KEY ("socialCommentId") REFERENCES "SocialComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: ENABLE alone is not enough. `startup-check.ts` refuses to boot on a table
-- that is enabled but not forced, because the owning role would bypass it.
DO $$
DECLARE
  covered text[] := ARRAY['SocialReply'];
  target text;
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
