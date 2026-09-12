-- Agency-fee receipts, and the recovery cases a reversal can open.
--
-- Until now "collected" was one timestamp on Booking, written by anyone with
-- bookings:EDIT — including the agent who made the sale — and it was the sole
-- gate before commission was called collected and gathered into a payout.
-- The owner's decisions of 12 September 2026 (D-8.1–D-8.5) replace that with
-- receipts: recorded by a finance role, verified by a different person, each
-- carrying an amount, currency, payment date, reference and evidence, and
-- measured against the booking's agreed agency fee. Booking.collectedAt stays
-- as legacy data. It is not migrated into a receipt: a timestamp is not
-- evidence of an amount.

CREATE TYPE "ReceiptKind" AS ENUM ('RECEIPT', 'REVERSAL');
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "RecoveryCaseStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "AgencyFeeReceipt" (
  "id"                     TEXT NOT NULL,
  "tenantId"               TEXT NOT NULL,
  "bookingId"              TEXT NOT NULL,
  "reference"              TEXT NOT NULL,
  "kind"                   "ReceiptKind"   NOT NULL DEFAULT 'RECEIPT',
  "status"                 "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
  "amount"                 DECIMAL(18,2) NOT NULL,
  "currency"               TEXT NOT NULL,
  "paidAt"                 TIMESTAMP(3) NOT NULL,
  "paymentReference"       TEXT NOT NULL,
  "providerTransactionRef" TEXT,
  "evidenceDocumentId"     TEXT,
  "reason"                 TEXT,
  "reversesId"             TEXT,
  "recordedById"           TEXT NOT NULL,
  "recordedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedById"           TEXT,
  "verifiedAt"             TIMESTAMP(3),
  "rejectedById"           TEXT,
  "rejectedAt"             TIMESTAMP(3),
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL,
  "updatedById"            TEXT,

  CONSTRAINT "AgencyFeeReceipt_pkey" PRIMARY KEY ("id"),

  -- D-8.3: a positive amount, always. A reversal's sign is its kind.
  CONSTRAINT "AgencyFeeReceipt_amount_check" CHECK ("amount" > 0),
  -- D-8.3: a free-text reference alone is not verification evidence.
  CONSTRAINT "AgencyFeeReceipt_evidence_check"
    CHECK ("providerTransactionRef" IS NOT NULL OR "evidenceDocumentId" IS NOT NULL),
  -- D-8.2: verified means by whom and when, together, and never by the recorder.
  CONSTRAINT "AgencyFeeReceipt_verified_pair_check"
    CHECK (("verifiedById" IS NULL) = ("verifiedAt" IS NULL)),
  CONSTRAINT "AgencyFeeReceipt_two_people_check"
    CHECK ("verifiedById" IS NULL OR "verifiedById" <> "recordedById"),
  CONSTRAINT "AgencyFeeReceipt_rejected_pair_check"
    CHECK (("rejectedById" IS NULL) = ("rejectedAt" IS NULL)),
  -- A reversal points at what it reverses; a receipt points at nothing.
  CONSTRAINT "AgencyFeeReceipt_reversal_target_check"
    CHECK (("kind" = 'REVERSAL') = ("reversesId" IS NOT NULL)),
  -- Status and its stamps agree.
  CONSTRAINT "AgencyFeeReceipt_status_stamps_check"
    CHECK (
      ("status" = 'VERIFIED' AND "verifiedById" IS NOT NULL AND "rejectedById" IS NULL)
      OR ("status" = 'REJECTED' AND "rejectedById" IS NOT NULL AND "verifiedById" IS NULL)
      OR ("status" = 'PENDING' AND "verifiedById" IS NULL AND "rejectedById" IS NULL)
    )
);

CREATE UNIQUE INDEX "AgencyFeeReceipt_tenantId_reference_key" ON "AgencyFeeReceipt"("tenantId", "reference");
CREATE INDEX "AgencyFeeReceipt_tenantId_bookingId_status_idx" ON "AgencyFeeReceipt"("tenantId", "bookingId", "status");
CREATE INDEX "AgencyFeeReceipt_reversesId_idx" ON "AgencyFeeReceipt"("reversesId");
CREATE INDEX "AgencyFeeReceipt_evidenceDocumentId_idx" ON "AgencyFeeReceipt"("evidenceDocumentId");

ALTER TABLE "AgencyFeeReceipt"
  ADD CONSTRAINT "AgencyFeeReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AgencyFeeReceipt_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AgencyFeeReceipt_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "AgencyFeeReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AgencyFeeReceipt_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CollectionRecoveryCase" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "bookingId"      TEXT NOT NULL,
  "commissionId"   TEXT NOT NULL,
  "payoutId"       TEXT,
  "receiptId"      TEXT NOT NULL,
  "status"         "RecoveryCaseStatus" NOT NULL DEFAULT 'OPEN',
  "shortfall"      DECIMAL(18,2) NOT NULL,
  "currency"       TEXT NOT NULL,
  "reason"         TEXT NOT NULL,
  "resolvedById"   TEXT,
  "resolvedAt"     TIMESTAMP(3),
  "resolutionNote" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "createdById"    TEXT,

  CONSTRAINT "CollectionRecoveryCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CollectionRecoveryCase_shortfall_check" CHECK ("shortfall" > 0),
  CONSTRAINT "CollectionRecoveryCase_resolved_pair_check"
    CHECK (("resolvedById" IS NULL) = ("resolvedAt" IS NULL))
);

CREATE INDEX "CollectionRecoveryCase_tenantId_status_idx" ON "CollectionRecoveryCase"("tenantId", "status");
CREATE INDEX "CollectionRecoveryCase_tenantId_commissionId_idx" ON "CollectionRecoveryCase"("tenantId", "commissionId");
CREATE INDEX "CollectionRecoveryCase_bookingId_idx" ON "CollectionRecoveryCase"("bookingId");
CREATE INDEX "CollectionRecoveryCase_receiptId_idx" ON "CollectionRecoveryCase"("receiptId");

ALTER TABLE "CollectionRecoveryCase"
  ADD CONSTRAINT "CollectionRecoveryCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CollectionRecoveryCase_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CollectionRecoveryCase_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CollectionRecoveryCase_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "AgencyFeeReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Permissions ──────────────────────────────────────────────────────────────
-- A new module rather than more actions on `bookings`, because the point is
-- that bookings:EDIT — the selling agent's permission — no longer reaches
-- collection at all.
INSERT INTO "Permission" ("id", "module", "action", "description") VALUES
  (gen_random_uuid()::text, 'collections', 'VIEW',    'See agency-fee receipts and coverage'),
  (gen_random_uuid()::text, 'collections', 'CREATE',  'Record an agency-fee receipt or a reversal'),
  (gen_random_uuid()::text, 'collections', 'APPROVE', 'Verify or reject a receipt recorded by someone else')
ON CONFLICT ("module", "action") DO NOTHING;

-- Existing workspaces: the designated finance role and the workspace
-- administrator get the module. Every other role gets nothing, which is the
-- decision — selling agents cannot record receipts. Scope follows the role's
-- default so a finance role scoped to a branch stays scoped to it.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, r."tenantId", r."id", p."id", true, r."defaultScope", NOW(), NOW()
FROM "Role" r
JOIN "Permission" p ON p."module" = 'collections'
WHERE r."key" IN ('finance_admin', 'company_admin')
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
  );

-- ── Tenant isolation ─────────────────────────────────────────────────────────
-- Same policy as every tenant-scoped table (see 20260819100000): RLS is FORCEd
-- because the migration role owns these tables and an owner bypasses RLS
-- without it — lib/startup-check.ts refuses to boot on exactly that condition.
DO $$
DECLARE
  target text;
  covered text[] := ARRAY['AgencyFeeReceipt', 'CollectionRecoveryCase'];
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
