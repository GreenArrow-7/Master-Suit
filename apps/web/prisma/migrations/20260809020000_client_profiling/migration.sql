-- M3 — Client profiling.
--
-- The requirement half of this module already shipped with M5, because the
-- demand check needed somewhere to read budget and location from. This is the
-- rest: who the buyer is, what they say about you afterwards, and who they send
-- next.
--
-- The tables Prisma generated are below unchanged. What follows them is the part
-- a datamodel cannot say: that a profile belongs to exactly one person and there
-- is only ever one of it, that a rating is out of five, that nothing gets
-- published without consent, and that two agents cannot both claim to have
-- introduced the same buyer.

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('SALARIED', 'SELF_EMPLOYED', 'BUSINESS_OWNER', 'PROFESSIONAL', 'RETIRED', 'STUDENT', 'NOT_WORKING', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('SCHOOL', 'DIPLOMA', 'BACHELORS', 'MASTERS', 'DOCTORATE', 'OTHER', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "PurchaseIntent" AS ENUM ('END_USE', 'INVESTMENT', 'BOTH', 'UNDECIDED');

-- CreateEnum
CREATE TYPE "TestimonialStatus" AS ENUM ('REQUESTED', 'SUBMITTED', 'APPROVED', 'PUBLISHED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'QUALIFIED', 'CONVERTED', 'REJECTED');

-- CreateTable
CREATE TABLE "ClientProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "profession" TEXT,
    "employmentType" "EmploymentType",
    "education" "EducationLevel",
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "purchaseIntent" "PurchaseIntent" NOT NULL DEFAULT 'UNDECIDED',
    "annualIncomeMin" DECIMAL(18,2),
    "annualIncomeMax" DECIMAL(18,2),
    "investmentCapacity" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "isMortgageRequired" BOOLEAN,
    "mortgagePreApproved" BOOLEAN,
    "nationality" TEXT,
    "residencyStatus" TEXT,
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ClientProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Testimonial" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "status" "TestimonialStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestMessage" TEXT,
    "rating" INTEGER,
    "body" TEXT,
    "submittedAt" TIMESTAMP(3),
    "consentToPublish" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Testimonial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "issuedById" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxUses" INTEGER,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "referredLeadId" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "referrerLeadId" TEXT,
    "referrerContactId" TEXT,
    "qualifiedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientProfile_tenantId_leadId_idx" ON "ClientProfile"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "ClientProfile_tenantId_contactId_idx" ON "ClientProfile"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "ClientProfile_tenantId_purchaseIntent_idx" ON "ClientProfile"("tenantId", "purchaseIntent");

-- CreateIndex
CREATE INDEX "ClientProfile_tenantId_ownerId_idx" ON "ClientProfile"("tenantId", "ownerId");

-- CreateIndex
CREATE INDEX "Testimonial_tenantId_status_requestedAt_idx" ON "Testimonial"("tenantId", "status", "requestedAt" DESC);

-- CreateIndex
CREATE INDEX "Testimonial_tenantId_leadId_idx" ON "Testimonial"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "Testimonial_tenantId_contactId_idx" ON "Testimonial"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "Testimonial_tenantId_ownerId_status_idx" ON "Testimonial"("tenantId", "ownerId", "status");

-- CreateIndex
CREATE INDEX "ReferralCode_tenantId_leadId_idx" ON "ReferralCode"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "ReferralCode_tenantId_contactId_idx" ON "ReferralCode"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "ReferralCode_tenantId_isActive_expiresAt_idx" ON "ReferralCode"("tenantId", "isActive", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_tenantId_code_key" ON "ReferralCode"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Referral_tenantId_status_createdAt_idx" ON "Referral"("tenantId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Referral_tenantId_codeId_idx" ON "Referral"("tenantId", "codeId");

-- CreateIndex
CREATE INDEX "Referral_tenantId_referrerLeadId_idx" ON "Referral"("tenantId", "referrerLeadId");

-- CreateIndex
CREATE INDEX "Referral_tenantId_referrerContactId_idx" ON "Referral"("tenantId", "referrerContactId");

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "ReferralCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Constraints the datamodel cannot express ───────────────────────────────

-- A profile, a testimonial and a code all belong to a person, and a person here
-- is a Lead before they are a Contact. The same shape ClientRequirement uses.
ALTER TABLE "ClientProfile"
    ADD CONSTRAINT "ClientProfile_subject_check"
    CHECK ("leadId" IS NOT NULL OR "contactId" IS NOT NULL);

ALTER TABLE "Testimonial"
    ADD CONSTRAINT "Testimonial_subject_check"
    CHECK ("leadId" IS NOT NULL OR "contactId" IS NOT NULL);

ALTER TABLE "ReferralCode"
    ADD CONSTRAINT "ReferralCode_subject_check"
    CHECK ("leadId" IS NOT NULL OR "contactId" IS NOT NULL);

-- One profile per person. Two profiles for the same buyer means two different
-- answers to "what can they afford", and whichever the query happens to read
-- first wins. Partial so a soft-deleted profile does not block a new one.
CREATE UNIQUE INDEX "ClientProfile_one_per_lead" ON "ClientProfile" ("tenantId", "leadId")
    WHERE "leadId" IS NOT NULL AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "ClientProfile_one_per_contact" ON "ClientProfile" ("tenantId", "contactId")
    WHERE "contactId" IS NOT NULL AND "deletedAt" IS NULL;

-- An income band that runs backwards matches nothing and reads as a typo
-- nobody catches. Same for a capacity below zero.
ALTER TABLE "ClientProfile"
    ADD CONSTRAINT "ClientProfile_income_range_check"
    CHECK (
      "annualIncomeMin" IS NULL
      OR "annualIncomeMax" IS NULL
      OR "annualIncomeMax" >= "annualIncomeMin"
    );

ALTER TABLE "ClientProfile"
    ADD CONSTRAINT "ClientProfile_amounts_check"
    CHECK (
      ("annualIncomeMin" IS NULL OR "annualIncomeMin" >= 0)
      AND ("annualIncomeMax" IS NULL OR "annualIncomeMax" >= 0)
      AND ("investmentCapacity" IS NULL OR "investmentCapacity" >= 0)
    );

-- Out of five. A 7-star review is a bug, not an opinion.
ALTER TABLE "Testimonial"
    ADD CONSTRAINT "Testimonial_rating_check"
    CHECK ("rating" IS NULL OR ("rating" BETWEEN 1 AND 5));

-- Submitted means they wrote something. An empty testimonial in the approval
-- queue wastes somebody's afternoon and cannot be published anyway.
ALTER TABLE "Testimonial"
    ADD CONSTRAINT "Testimonial_body_check"
    CHECK (
      "status" IN ('REQUESTED', 'DECLINED')
      OR ("body" IS NOT NULL AND length(btrim("body")) > 0)
    );

-- Nothing goes public without the client having said it may. Enforced here
-- rather than in the service because "we always remember to check" is exactly
-- how somebody's words end up on a website they never agreed to.
ALTER TABLE "Testimonial"
    ADD CONSTRAINT "Testimonial_publish_consent_check"
    CHECK ("status" <> 'PUBLISHED' OR "consentToPublish" = true);

ALTER TABLE "Testimonial"
    ADD CONSTRAINT "Testimonial_declined_check"
    CHECK (("status" = 'DECLINED') = ("declinedAt" IS NOT NULL));

-- A code with a use limit must allow at least one use; zero means "issued and
-- already dead", which is a way of silently never attributing anything.
ALTER TABLE "ReferralCode"
    ADD CONSTRAINT "ReferralCode_max_uses_check"
    CHECK ("maxUses" IS NULL OR "maxUses" >= 1);

-- One referral per referred lead. Two agents both claiming to have introduced
-- the same buyer is a commission dispute, and the database is the only place
-- that can refuse it under concurrency.
CREATE UNIQUE INDEX "Referral_one_per_lead" ON "Referral" ("tenantId", "referredLeadId")
    WHERE "deletedAt" IS NULL;

-- You cannot refer yourself. The service checks the contact side too, which
-- spans tables and so cannot live here.
ALTER TABLE "Referral"
    ADD CONSTRAINT "Referral_not_self_check"
    CHECK ("referrerLeadId" IS NULL OR "referrerLeadId" <> "referredLeadId");

ALTER TABLE "Referral"
    ADD CONSTRAINT "Referral_rejected_check"
    CHECK (("status" = 'REJECTED') = ("rejectedAt" IS NOT NULL));

-- ── Permissions ────────────────────────────────────────────────────────────
INSERT INTO "Permission" ("id", "module", "action", "description") VALUES
  (gen_random_uuid()::text, 'clientprofiles', 'VIEW',   'See a client profile'),
  (gen_random_uuid()::text, 'clientprofiles', 'CREATE', 'Start a client profile'),
  (gen_random_uuid()::text, 'clientprofiles', 'EDIT',   'Amend a client profile'),
  (gen_random_uuid()::text, 'clientprofiles', 'DELETE', 'Remove a client profile'),
  (gen_random_uuid()::text, 'testimonials',   'VIEW',    'See testimonials'),
  (gen_random_uuid()::text, 'testimonials',   'CREATE',  'Ask a client for a testimonial'),
  (gen_random_uuid()::text, 'testimonials',   'EDIT',    'Amend or decline a testimonial'),
  (gen_random_uuid()::text, 'testimonials',   'APPROVE', 'Approve and publish a testimonial'),
  (gen_random_uuid()::text, 'referrals',      'VIEW',    'See referrals and codes'),
  (gen_random_uuid()::text, 'referrals',      'CREATE',  'Issue a referral code'),
  (gen_random_uuid()::text, 'referrals',      'EDIT',    'Progress or reject a referral')
ON CONFLICT ("module", "action") DO NOTHING;

-- clientprofiles ← leads, at the same scope. A profile is an attribute of the
-- person, exactly as a requirement is; whoever may work the lead may record who
-- they are.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'clientprofiles' AND target."action" = source."action"
WHERE source."module" = 'leads' AND source."action" IN ('VIEW', 'CREATE', 'EDIT', 'DELETE')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- testimonials and referrals ← leads, but only the three verbs an agent needs.
-- APPROVE is deliberately not derived: deciding what goes on the website under a
-- client's name is not the same authority as working that client.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target
  ON target."module" IN ('testimonials', 'referrals') AND target."action" = source."action"
WHERE source."module" = 'leads' AND source."action" IN ('VIEW', 'CREATE', 'EDIT')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ── Row-level security ─────────────────────────────────────────────────────
-- Four tables, named explicitly. See the note in the M4 migration on why this
-- does not re-run the catalog-driven sweep.
DO $$
DECLARE
  target TEXT;
  covered CONSTANT TEXT[] := ARRAY['ClientProfile', 'Testimonial', 'ReferralCode', 'Referral'];
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
