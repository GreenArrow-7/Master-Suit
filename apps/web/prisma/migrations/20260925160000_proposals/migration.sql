-- Proposals: a branded shortlist a client can open without logging in.
--
-- Hand-written, for the reason the portal migrations give: `migrate diff`
-- against this database also emits DROP TABLE "PlatformCoverageGrant" and drops
-- two "PlatformAccessGrant" columns, because two applied migrations are absent
-- from the repository. Only the statements for this change are below.

CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SENT', 'CLOSED');
CREATE TYPE "ProposalReaction" AS ENUM ('INTERESTED', 'NOT_INTERESTED');

CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "requirementId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerId" TEXT,
    "sentAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "firstViewedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProposalItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "reaction" "ProposalReaction",
    "comment" TEXT,
    "reactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProposalItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Proposal_tenantId_status_createdAt_idx" ON "Proposal"("tenantId", "status", "createdAt" DESC);
CREATE INDEX "Proposal_tenantId_leadId_idx" ON "Proposal"("tenantId", "leadId");
CREATE INDEX "Proposal_tenantId_contactId_idx" ON "Proposal"("tenantId", "contactId");
CREATE INDEX "Proposal_tenantId_ownerId_status_idx" ON "Proposal"("tenantId", "ownerId", "status");
CREATE UNIQUE INDEX "ProposalItem_proposalId_listingId_key" ON "ProposalItem"("proposalId", "listingId");
CREATE INDEX "ProposalItem_tenantId_proposalId_position_idx" ON "ProposalItem"("tenantId", "proposalId", "position");

ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProposalItem" ADD CONSTRAINT "ProposalItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProposalItem" ADD CONSTRAINT "ProposalItem_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProposalItem" ADD CONSTRAINT "ProposalItem_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A proposal addressed to nobody cannot be followed up, and the whole point of
-- the record is knowing who saw it. Same rule ClientRequirement carries.
ALTER TABLE "Proposal"
  ADD CONSTRAINT "Proposal_has_a_client"
  CHECK ("leadId" IS NOT NULL OR "contactId" IS NOT NULL);

-- Sent means sent. A row claiming SENT with no date cannot answer "when did we
-- send this", which is the first thing asked when a client says they never got it.
ALTER TABLE "Proposal"
  ADD CONSTRAINT "Proposal_sent_has_a_date"
  CHECK ("status" <> 'SENT' OR "sentAt" IS NOT NULL);

-- An opinion with no timestamp is an opinion that cannot be ordered against the
-- call that followed it.
ALTER TABLE "ProposalItem"
  ADD CONSTRAINT "ProposalItem_reaction_has_a_date"
  CHECK ("reaction" IS NULL OR "reactedAt" IS NOT NULL);

-- Tenant isolation, same policy as every tenant-scoped table.
DO $$
DECLARE
  target text;
  covered text[] := ARRAY['Proposal', 'ProposalItem'];
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
