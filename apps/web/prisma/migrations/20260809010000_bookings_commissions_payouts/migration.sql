-- Bookings, commissions, slabs and payouts (M9).
--
-- The spec gates this module: "M9 requires the commission slab rules to be
-- documented and signed off by finance *before* any code is written."
--
-- That is honoured by shipping no rates. There is not a single percentage in
-- this migration or in the service behind it. A slab is rows — bands, a mode, an
-- effective window and an approver — and accrual refuses to run against a slab
-- nobody has signed. Finance can therefore document and approve the rules on
-- their own timetable, and the code was written without pre-empting them.
--
-- Two rules are structural rather than procedural, because money is the one
-- place "we always remember to" is not good enough:
--
--   1. **A commission freezes the rule that made it.** The rate, the mode, the
--      slab version and a full breakdown of which band contributed what are
--      copied onto the row at accrual and never re-read. A workspace that
--      renegotiates in March must not restate February, and a payout already
--      made must stay reconcilable against the number that produced it. This is
--      the same reasoning HrSettlementSnapshot uses for gratuity.
--
--   2. **Nothing is deleted and nothing is edited backwards.** A cancelled sale
--      produces a clawback row carrying a negative amount and pointing at the
--      commission it reverses; the original is left exactly as it was. The
--      ledger is append-only in effect, so a reconciliation report can always
--      tie every amount to its source booking.

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SlabMode" AS ENUM ('PROGRESSIVE', 'FLAT');

-- CreateEnum
CREATE TYPE "SlabBasis" AS ENUM ('PERCENT_OF_SALE', 'PERCENT_OF_AGENCY_FEE', 'FIXED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('ACCRUED', 'CONFIRMED', 'COLLECTED', 'PAID', 'CLAWED_BACK');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "accountId" TEXT,
    "projectId" TEXT,
    "unitInventoryId" TEXT,
    "listingId" TEXT,
    "ownerId" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'DRAFT',
    "saleValue" DECIMAL(18,2) NOT NULL,
    "agencyFee" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "bookingDate" TIMESTAMP(3) NOT NULL,
    "agreementDate" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionSlab" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "mode" "SlabMode" NOT NULL DEFAULT 'PROGRESSIVE',
    "basis" "SlabBasis" NOT NULL DEFAULT 'PERCENT_OF_SALE',
    "projectId" TEXT,
    "developerId" TEXT,
    "listingType" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "CommissionSlab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionSlabBand" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slabId" TEXT NOT NULL,
    "fromAmount" DECIMAL(18,2) NOT NULL,
    "toAmount" DECIMAL(18,2),
    "ratePct" DECIMAL(9,4),
    "fixedAmount" DECIMAL(18,2),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionSlabBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'ACCRUED',
    "slabId" TEXT,
    "slabVersion" INTEGER,
    "slabMode" "SlabMode",
    "slabBasis" "SlabBasis",
    "effectiveRatePct" DECIMAL(9,4),
    "calculation" JSONB NOT NULL DEFAULT '{}',
    "baseAmount" DECIMAL(18,2) NOT NULL,
    "sharePct" DECIMAL(7,4) NOT NULL DEFAULT 100,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "payoutId" TEXT,
    "paidAt" TIMESTAMP(3),
    "reversesId" TEXT,
    "clawbackNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Booking_tenantId_status_bookingDate_idx" ON "Booking"("tenantId", "status", "bookingDate");

-- CreateIndex
CREATE INDEX "Booking_tenantId_ownerId_bookingDate_idx" ON "Booking"("tenantId", "ownerId", "bookingDate");

-- CreateIndex
CREATE INDEX "Booking_tenantId_projectId_idx" ON "Booking"("tenantId", "projectId");

-- CreateIndex
CREATE INDEX "Booking_tenantId_leadId_idx" ON "Booking"("tenantId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_tenantId_reference_key" ON "Booking"("tenantId", "reference");

-- CreateIndex
CREATE INDEX "CommissionSlab_tenantId_isActive_effectiveFrom_idx" ON "CommissionSlab"("tenantId", "isActive", "effectiveFrom");

-- CreateIndex
CREATE INDEX "CommissionSlab_tenantId_projectId_idx" ON "CommissionSlab"("tenantId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionSlab_tenantId_name_version_key" ON "CommissionSlab"("tenantId", "name", "version");

-- CreateIndex
CREATE INDEX "CommissionSlabBand_tenantId_slabId_position_idx" ON "CommissionSlabBand"("tenantId", "slabId", "position");

-- CreateIndex
CREATE INDEX "Commission_tenantId_userId_status_idx" ON "Commission"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "Commission_tenantId_bookingId_idx" ON "Commission"("tenantId", "bookingId");

-- CreateIndex
CREATE INDEX "Commission_tenantId_status_createdAt_idx" ON "Commission"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Commission_tenantId_payoutId_idx" ON "Commission"("tenantId", "payoutId");

-- CreateIndex
CREATE INDEX "Payout_tenantId_userId_status_idx" ON "Payout"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "Payout_tenantId_status_periodEnd_idx" ON "Payout"("tenantId", "status", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_tenantId_reference_key" ON "Payout"("tenantId", "reference");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_unitInventoryId_fkey" FOREIGN KEY ("unitInventoryId") REFERENCES "UnitInventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionSlabBand" ADD CONSTRAINT "CommissionSlabBand_slabId_fkey" FOREIGN KEY ("slabId") REFERENCES "CommissionSlab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_slabId_fkey" FOREIGN KEY ("slabId") REFERENCES "CommissionSlab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Integrity: the arithmetic cannot be wrong in the database ───────────────

ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_sale_value_check" CHECK ("saleValue" > 0);

ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_agency_fee_check"
    CHECK ("agencyFee" IS NULL OR "agencyFee" >= 0);

-- A sale belongs to somebody and is of something. Without either, no commission
-- can be attributed and no reconciliation can trace it.
ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_buyer_check"
    CHECK ("leadId" IS NOT NULL OR "contactId" IS NOT NULL OR "accountId" IS NOT NULL);

ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_subject_check"
    CHECK ("projectId" IS NOT NULL OR "listingId" IS NOT NULL OR "unitInventoryId" IS NOT NULL);

-- A cancellation carries its reason, or the clawback it triggers is unexplainable
-- a year later.
ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_cancel_check"
    CHECK (("cancelledAt" IS NULL) = ("cancelReason" IS NULL));

-- A band that runs backwards silently matches nothing, so a sale in that range
-- accrues zero and nobody notices until payday.
ALTER TABLE "CommissionSlabBand"
    ADD CONSTRAINT "CommissionSlabBand_range_check"
    CHECK ("fromAmount" >= 0 AND ("toAmount" IS NULL OR "toAmount" > "fromAmount"));

-- Exactly one of the two ways a band pays. Both set is ambiguous; neither is a
-- band that earns nothing.
ALTER TABLE "CommissionSlabBand"
    ADD CONSTRAINT "CommissionSlabBand_amount_check"
    CHECK (("ratePct" IS NULL) <> ("fixedAmount" IS NULL));

ALTER TABLE "CommissionSlabBand"
    ADD CONSTRAINT "CommissionSlabBand_rate_check"
    CHECK ("ratePct" IS NULL OR ("ratePct" >= 0 AND "ratePct" <= 100));

-- A slab whose window runs backwards is never in force, so every accrual falls
-- through to the default and nobody is told why.
ALTER TABLE "CommissionSlab"
    ADD CONSTRAINT "CommissionSlab_window_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");

-- The sign-off the spec requires, made structural: an approval is a person and
-- a time, together or not at all.
ALTER TABLE "CommissionSlab"
    ADD CONSTRAINT "CommissionSlab_approval_check"
    CHECK (("approvedById" IS NULL) = ("approvedAt" IS NULL));

-- A share outside 0–100 produces a split that does not add up, and the error
-- compounds through every report built on it.
ALTER TABLE "Commission"
    ADD CONSTRAINT "Commission_share_check"
    CHECK ("sharePct" > 0 AND "sharePct" <= 100);

ALTER TABLE "Commission"
    ADD CONSTRAINT "Commission_base_check" CHECK ("baseAmount" >= 0);

-- A clawback is negative and points at what it reverses; everything else is
-- positive and points at nothing. Stated here because the sign of a number is
-- the difference between owing and being owed.
ALTER TABLE "Commission"
    ADD CONSTRAINT "Commission_clawback_check"
    CHECK (
      ("status" = 'CLAWED_BACK' AND "reversesId" IS NOT NULL AND "amount" <= 0)
      OR ("status" <> 'CLAWED_BACK' AND "reversesId" IS NULL AND "amount" >= 0)
    );

-- One reversal per commission. Clawing the same money back twice is how a
-- ledger goes negative for a reason nobody can find.
CREATE UNIQUE INDEX "Commission_one_reversal" ON "Commission" ("reversesId")
    WHERE "reversesId" IS NOT NULL;

ALTER TABLE "Payout"
    ADD CONSTRAINT "Payout_period_check" CHECK ("periodEnd" >= "periodStart");

-- ── Permissions ────────────────────────────────────────────────────────────
--
-- Four authorities, deliberately separate, because this is the module where one
-- person holding all of them is the finding an auditor writes up.
--
--   bookings   — recording that a sale happened
--   commissions— seeing what is owed, and confirming the number is right
--   payouts    — releasing money
--   slabs      — writing the rules, which is finance's and nobody else's
--
-- None of them is granted to anybody by default. Not a conservative default —
-- the correct one: an existing workspace has never had a commission module, so
-- nobody has an established claim to any of it, and a migration that guessed
-- would be handing out the right to approve money.
INSERT INTO "Permission" ("id", "module", "action", "description")
VALUES
  (gen_random_uuid()::text, 'bookings', 'VIEW',    'See bookings'),
  (gen_random_uuid()::text, 'bookings', 'CREATE',  'Record a booking'),
  (gen_random_uuid()::text, 'bookings', 'EDIT',    'Amend or cancel a booking'),
  (gen_random_uuid()::text, 'bookings', 'DELETE',  'Archive a booking'),
  (gen_random_uuid()::text, 'commissions', 'VIEW',    'See what is owed'),
  (gen_random_uuid()::text, 'commissions', 'EDIT',    'Adjust a split before it is confirmed'),
  (gen_random_uuid()::text, 'commissions', 'APPROVE', 'Confirm a commission, and claw one back'),
  (gen_random_uuid()::text, 'commissions', 'EXPORT',  'Export the ledger and reconciliation'),
  (gen_random_uuid()::text, 'payouts', 'VIEW',    'See payouts and statements'),
  (gen_random_uuid()::text, 'payouts', 'CREATE',  'Build a payout run'),
  (gen_random_uuid()::text, 'payouts', 'APPROVE', 'Approve and release a payout'),
  (gen_random_uuid()::text, 'commissionslabs', 'VIEW',    'See the commission rules'),
  (gen_random_uuid()::text, 'commissionslabs', 'EDIT',    'Draft a commission slab'),
  (gen_random_uuid()::text, 'commissionslabs', 'APPROVE', 'Sign off a commission slab')
ON CONFLICT ("module", "action") DO NOTHING;

-- One exception to "granted to nobody": an agent seeing their *own* commissions.
-- Derived from `targets:VIEW` at OWN scope, because whoever may already see
-- their own quota may see what they earned against it. Anything wider — another
-- person's earnings, the rules, or a payout — stays unassigned until somebody
-- decides who should hold it.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", 'OWN', NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'commissions' AND target."action" = 'VIEW'
WHERE source."module" = 'targets' AND source."action" = 'VIEW'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ── Row-level security ─────────────────────────────────────────────────────
DO $$
DECLARE
  target TEXT;
  covered CONSTANT TEXT[] := ARRAY['Booking', 'CommissionSlab', 'CommissionSlabBand', 'Commission', 'Payout'];
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
