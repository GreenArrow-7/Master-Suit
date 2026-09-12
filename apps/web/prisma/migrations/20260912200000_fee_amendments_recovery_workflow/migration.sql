-- D-20 (agency-fee amendments), recovery-case handling, and the payroll
-- placement snapshot the P&L needs.
--
-- Three things, one migration, because they share a deployment: all three are
-- additive — new tables and nullable columns — and none can fail on existing
-- data.

-- ── D-20: the agreed agency fee is a controlled commercial term ─────────────
CREATE TYPE "FeeAmendmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "AgencyFeeAmendment" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "bookingId"          TEXT NOT NULL,
  "reference"          TEXT NOT NULL,
  "status"             "FeeAmendmentStatus" NOT NULL DEFAULT 'PENDING',
  "previousFee"        DECIMAL(18,2),
  "proposedFee"        DECIMAL(18,2) NOT NULL,
  "currency"           TEXT NOT NULL,
  "reason"             TEXT NOT NULL,
  "agreementReference" TEXT NOT NULL,
  "preview"            JSONB NOT NULL DEFAULT '{}',
  "proposedById"       TEXT NOT NULL,
  "proposedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedById"        TEXT,
  "decidedAt"          TIMESTAMP(3),
  "decisionNote"       TEXT,
  "appliedAt"          TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgencyFeeAmendment_pkey" PRIMARY KEY ("id"),
  -- Zero-fee bookings are not supported by amendment: a fee of nothing cannot
  -- qualify a commission, and inventing one is what this table exists to stop.
  CONSTRAINT "AgencyFeeAmendment_positive_check" CHECK ("proposedFee" > 0),
  -- The proposer never decides their own amendment. NULL decidedById is the
  -- pre-confirmation case, which needs no approver and says so in its note.
  CONSTRAINT "AgencyFeeAmendment_two_people_check" CHECK ("decidedById" IS NULL OR "decidedById" <> "proposedById"),
  CONSTRAINT "AgencyFeeAmendment_decided_check" CHECK ("status" = 'PENDING' OR "decidedAt" IS NOT NULL),
  CONSTRAINT "AgencyFeeAmendment_applied_check" CHECK ("status" = 'APPROVED' OR "appliedAt" IS NULL)
);

CREATE UNIQUE INDEX "AgencyFeeAmendment_tenantId_reference_key" ON "AgencyFeeAmendment"("tenantId", "reference");
-- One open proposal per booking; a second is a conversation, not a queue.
CREATE UNIQUE INDEX "AgencyFeeAmendment_one_pending_per_booking" ON "AgencyFeeAmendment"("bookingId") WHERE "status" = 'PENDING';
CREATE INDEX "AgencyFeeAmendment_tenantId_bookingId_status_idx" ON "AgencyFeeAmendment"("tenantId", "bookingId", "status");
CREATE INDEX "AgencyFeeAmendment_tenantId_status_idx" ON "AgencyFeeAmendment"("tenantId", "status");

ALTER TABLE "AgencyFeeAmendment"
  ADD CONSTRAINT "AgencyFeeAmendment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AgencyFeeAmendment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Recovery cases: a workflow, not a row ───────────────────────────────────
-- A case can now come from a fee amendment as well as a receipt reversal, be
-- assigned, acknowledged (which is not recovery), recovered with evidence, or
-- written off / adjusted under a second person's approval.
CREATE TYPE "RecoveryCaseKind" AS ENUM ('RECEIPT_REVERSAL', 'FEE_AMENDMENT');
CREATE TYPE "RecoveryOutcome" AS ENUM ('RECOVERED', 'WRITTEN_OFF', 'ADJUSTED');
-- Postgres refuses to *use* an enum value added in the same transaction, so
-- these two are added here and first used by application code.
ALTER TYPE "RecoveryCaseStatus" ADD VALUE IF NOT EXISTS 'ACKNOWLEDGED';
ALTER TYPE "RecoveryCaseStatus" ADD VALUE IF NOT EXISTS 'RESOLUTION_PROPOSED';

ALTER TABLE "CollectionRecoveryCase"
  ADD COLUMN "kind"                   "RecoveryCaseKind" NOT NULL DEFAULT 'RECEIPT_REVERSAL',
  ADD COLUMN "amendmentId"            TEXT,
  ADD COLUMN "adjustment"             DECIMAL(18,2),
  ADD COLUMN "assigneeId"             TEXT,
  ADD COLUMN "acknowledgedById"       TEXT,
  ADD COLUMN "acknowledgedAt"         TIMESTAMP(3),
  ADD COLUMN "outcome"                "RecoveryOutcome",
  ADD COLUMN "recoveredAmount"        DECIMAL(18,2),
  ADD COLUMN "resolutionReference"    TEXT,
  ADD COLUMN "providerTransactionRef" TEXT,
  ADD COLUMN "evidenceDocumentId"     TEXT,
  ADD COLUMN "proposedOutcome"        "RecoveryOutcome",
  ADD COLUMN "proposedById"           TEXT,
  ADD COLUMN "proposedAt"             TIMESTAMP(3),
  ADD COLUMN "proposalReason"         TEXT,
  ADD COLUMN "approvedById"           TEXT,
  ADD COLUMN "approvedAt"             TIMESTAMP(3),
  ALTER COLUMN "receiptId" DROP NOT NULL,
  ALTER COLUMN "shortfall" DROP NOT NULL;

ALTER TABLE "CollectionRecoveryCase" DROP CONSTRAINT "CollectionRecoveryCase_shortfall_check";
ALTER TABLE "CollectionRecoveryCase"
  ADD CONSTRAINT "CollectionRecoveryCase_shortfall_check" CHECK ("shortfall" IS NULL OR "shortfall" > 0),
  -- A case knows where it came from.
  ADD CONSTRAINT "CollectionRecoveryCase_origin_check" CHECK (
    ("kind" = 'RECEIPT_REVERSAL' AND "receiptId" IS NOT NULL)
    OR ("kind" = 'FEE_AMENDMENT' AND "amendmentId" IS NOT NULL)
  ),
  -- Recovered means money with evidence, never a note.
  ADD CONSTRAINT "CollectionRecoveryCase_recovered_evidence_check" CHECK (
    "outcome" IS DISTINCT FROM 'RECOVERED'
    OR ("recoveredAmount" IS NOT NULL AND "recoveredAmount" > 0 AND "resolutionReference" IS NOT NULL
        AND ("providerTransactionRef" IS NOT NULL OR "evidenceDocumentId" IS NOT NULL))
  ),
  -- A write-off or adjustment is two people: the one who proposed it and a different one who approved.
  ADD CONSTRAINT "CollectionRecoveryCase_two_people_check" CHECK ("approvedById" IS NULL OR "approvedById" <> "proposedById"),
  ADD CONSTRAINT "CollectionRecoveryCase_writeoff_approval_check" CHECK (
    "outcome" IS NULL OR "outcome" = 'RECOVERED' OR ("proposedById" IS NOT NULL AND "approvedById" IS NOT NULL)
  ),
  ADD CONSTRAINT "CollectionRecoveryCase_amendmentId_fkey" FOREIGN KEY ("amendmentId") REFERENCES "AgencyFeeAmendment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CollectionRecoveryCase_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CollectionRecoveryCase_amendmentId_idx" ON "CollectionRecoveryCase"("amendmentId");
CREATE INDEX "CollectionRecoveryCase_tenantId_assigneeId_status_idx" ON "CollectionRecoveryCase"("tenantId", "assigneeId", "status");
CREATE INDEX "CollectionRecoveryCase_evidenceDocumentId_idx" ON "CollectionRecoveryCase"("evidenceDocumentId");

-- ── P&L: where the employee sat when the payslip was calculated ─────────────
-- The booking side already freezes placement at confirmation so a transfer
-- cannot restate a closed period. Payroll cost read the employee's *current*
-- team, which does exactly that. Nullable: payslips calculated before this
-- migration have no snapshot and the report says so.
ALTER TABLE "HrPayslip"
  ADD COLUMN "teamIdSnapshot"   TEXT,
  ADD COLUMN "branchIdSnapshot" TEXT,
  ADD COLUMN "regionIdSnapshot" TEXT;

-- ── Permissions ──────────────────────────────────────────────────────────────
INSERT INTO "Permission" ("id", "module", "action", "description") VALUES
  (gen_random_uuid()::text, 'agencyfee', 'VIEW',    'See agreed agency fees and their amendment history'),
  (gen_random_uuid()::text, 'agencyfee', 'CREATE',  'Propose the agreed agency fee or an amendment to it'),
  (gen_random_uuid()::text, 'agencyfee', 'APPROVE', 'Approve or reject a proposed agency-fee amendment')
ON CONFLICT ("module", "action") DO NOTHING;

-- Commercial administrators propose; the finance role approves; the workspace
-- administrator holds the catalogue as before. The two-people checks make the
-- overlap harmless: one account still cannot do both halves of one amendment.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, r."tenantId", r."id", p."id", true, r."defaultScope", NOW(), NOW()
FROM "Role" r
JOIN "Permission" p ON p."module" = 'agencyfee'
WHERE (
      (r."key" = 'company_admin')
   OR (r."key" = 'sales_director' AND p."action" IN ('VIEW', 'CREATE'))
   OR (r."key" = 'finance_admin' AND p."action" IN ('VIEW', 'APPROVE'))
  )
  AND NOT EXISTS (SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id");

-- ── Tenant isolation ─────────────────────────────────────────────────────────
DO $$
DECLARE
  target text;
  covered text[] := ARRAY['AgencyFeeAmendment'];
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
