-- Resale and rental listings, the mandates that permit them, and the client
-- requirements they are matched against (M5, plus one table from M3).
--
-- M4 catalogued developer inventory: stock the agency sells on behalf of the
-- people who built it. This is the other half of the book — stock owned by
-- somebody else, marketed under an agreement with an end date. That agreement is
-- the whole difference, and it is why Mandate is a table: a listing outlives the
-- mandates on it, and marketing a property whose mandate lapsed is a compliance
-- problem rather than an untidy record. A partial unique index enforces that at
-- most one mandate per listing is ever ACTIVE.
--
-- ClientRequirement is the single table from M3 that the demand check needs.
-- The rest of client profiling is not built: matching stock to demand does not
-- need to know a buyer education or profession, and inventing the other six
-- columns now would be guessing at a module nobody has specified in detail.
--
-- The three GIN indexes the M4 migration created by hand are now declared in
-- schema.prisma as well. They were invisible to Prisma, so the first
--  after this module proposed dropping all three — which would
-- have turned a 110 ms catalogue into a sequential scan with nothing failing.

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('SALE', 'RENT');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'UNDER_OFFER', 'SOLD', 'RENTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'VILLA', 'TOWNHOUSE', 'PENTHOUSE', 'PLOT', 'OFFICE', 'RETAIL', 'WAREHOUSE');

-- CreateEnum
CREATE TYPE "Furnishing" AS ENUM ('UNFURNISHED', 'SEMI_FURNISHED', 'FURNISHED');

-- CreateEnum
CREATE TYPE "RentFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "MandateType" AS ENUM ('EXCLUSIVE', 'NON_EXCLUSIVE', 'OPEN');

-- CreateEnum
CREATE TYPE "MandateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "RequirementPurpose" AS ENUM ('BUY', 'RENT');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('OPEN', 'MATCHED', 'FULFILLED', 'CLOSED');

-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "phoneNormalized" TEXT,
    "email" TEXT,
    "whatsappNumber" TEXT,
    "nationality" TEXT,
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "listingType" "ListingType" NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "propertyType" "PropertyType" NOT NULL DEFAULT 'APARTMENT',
    "propertyOwnerId" TEXT,
    "ownerId" TEXT,
    "projectId" TEXT,
    "unitInventoryId" TEXT,
    "micromarketId" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "areaSqft" INTEGER,
    "parkingSpaces" INTEGER,
    "furnishing" "Furnishing",
    "price" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "rentFrequency" "RentFrequency",
    "availableFrom" TIMESTAMP(3),
    "amenityKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "mandateType" "MandateType",
    "mandateExpires" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingMedia" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "kind" "ProjectMediaKind" NOT NULL DEFAULT 'IMAGE',
    "title" TEXT,
    "storageKey" TEXT,
    "externalUrl" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ListingMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mandate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" "MandateType" NOT NULL DEFAULT 'NON_EXCLUSIVE',
    "status" "MandateStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "commissionPct" DECIMAL(6,3),
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "documentKey" TEXT,
    "signedAt" TIMESTAMP(3),
    "terminatedAt" TIMESTAMP(3),
    "terminationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Mandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientRequirement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "purpose" "RequirementPurpose" NOT NULL,
    "status" "RequirementStatus" NOT NULL DEFAULT 'OPEN',
    "propertyTypes" "PropertyType"[] DEFAULT ARRAY[]::"PropertyType"[],
    "micromarketIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bedroomsMin" INTEGER,
    "bedroomsMax" INTEGER,
    "areaMinSqft" INTEGER,
    "budgetMin" DECIMAL(18,2),
    "budgetMax" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "possessionBy" TIMESTAMP(3),
    "furnishing" "Furnishing",
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ClientRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Owner_tenantId_phoneNormalized_idx" ON "Owner"("tenantId", "phoneNormalized");

-- CreateIndex
CREATE INDEX "Owner_tenantId_ownerId_idx" ON "Owner"("tenantId", "ownerId");

-- CreateIndex
CREATE INDEX "Owner_tenantId_fullName_idx" ON "Owner"("tenantId", "fullName");

-- CreateIndex
CREATE INDEX "Listing_tenantId_deletedAt_updatedAt_id_idx" ON "Listing"("tenantId", "deletedAt", "updatedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Listing_tenantId_status_listingType_price_idx" ON "Listing"("tenantId", "status", "listingType", "price");

-- CreateIndex
CREATE INDEX "Listing_tenantId_micromarketId_status_idx" ON "Listing"("tenantId", "micromarketId", "status");

-- CreateIndex
CREATE INDEX "Listing_tenantId_propertyType_bedrooms_idx" ON "Listing"("tenantId", "propertyType", "bedrooms");

-- CreateIndex
CREATE INDEX "Listing_tenantId_ownerId_status_idx" ON "Listing"("tenantId", "ownerId", "status");

-- CreateIndex
CREATE INDEX "Listing_tenantId_propertyOwnerId_idx" ON "Listing"("tenantId", "propertyOwnerId");

-- CreateIndex
CREATE INDEX "Listing_tenantId_status_mandateExpires_idx" ON "Listing"("tenantId", "status", "mandateExpires");

-- CreateIndex
CREATE INDEX "Listing_title_trgm_idx" ON "Listing" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Listing_amenityKeys_idx" ON "Listing" USING GIN ("amenityKeys");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_tenantId_reference_key" ON "Listing"("tenantId", "reference");

-- CreateIndex
CREATE INDEX "ListingMedia_tenantId_listingId_kind_position_idx" ON "ListingMedia"("tenantId", "listingId", "kind", "position");

-- CreateIndex
CREATE INDEX "Mandate_tenantId_listingId_status_idx" ON "Mandate"("tenantId", "listingId", "status");

-- CreateIndex
CREATE INDEX "Mandate_tenantId_status_expiresAt_idx" ON "Mandate"("tenantId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "Mandate_tenantId_ownerId_idx" ON "Mandate"("tenantId", "ownerId");

-- CreateIndex
CREATE INDEX "ClientRequirement_tenantId_status_purpose_idx" ON "ClientRequirement"("tenantId", "status", "purpose");

-- CreateIndex
CREATE INDEX "ClientRequirement_tenantId_leadId_idx" ON "ClientRequirement"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "ClientRequirement_tenantId_contactId_idx" ON "ClientRequirement"("tenantId", "contactId");

-- CreateIndex
CREATE INDEX "ClientRequirement_tenantId_ownerId_status_idx" ON "ClientRequirement"("tenantId", "ownerId", "status");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_propertyOwnerId_fkey" FOREIGN KEY ("propertyOwnerId") REFERENCES "Owner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_unitInventoryId_fkey" FOREIGN KEY ("unitInventoryId") REFERENCES "UnitInventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_micromarketId_fkey" FOREIGN KEY ("micromarketId") REFERENCES "Micromarket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingMedia" ADD CONSTRAINT "ListingMedia_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mandate" ADD CONSTRAINT "Mandate_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mandate" ADD CONSTRAINT "Mandate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Integrity the application must not be the only one enforcing ────────────

-- A rental with no frequency is a number nobody can read: 8 000 a month and
-- 8 000 a year are different properties. A sale with one is noise.
ALTER TABLE "Listing"
    ADD CONSTRAINT "Listing_rent_frequency_check"
    CHECK (
      ("listingType" = 'RENT'  AND "rentFrequency" IS NOT NULL) OR
      ("listingType" = 'SALE'  AND "rentFrequency" IS NULL)
    );

ALTER TABLE "Listing"
    ADD CONSTRAINT "Listing_price_check" CHECK ("price" > 0);

ALTER TABLE "Listing"
    ADD CONSTRAINT "Listing_bedrooms_check"
    CHECK ("bedrooms" IS NULL OR ("bedrooms" >= 0 AND "bedrooms" <= 50));

-- A mandate that ends before it starts is a data-entry slip that turns into a
-- listing which is never live and never expires.
ALTER TABLE "Mandate"
    ADD CONSTRAINT "Mandate_period_check" CHECK ("expiresAt" > "startsAt");

ALTER TABLE "Mandate"
    ADD CONSTRAINT "Mandate_commission_check"
    CHECK ("commissionPct" IS NULL OR ("commissionPct" >= 0 AND "commissionPct" <= 100));

-- One live mandate per listing. Two active mandates on the same property is the
-- state the whole table exists to prevent — an exclusive and an open agreement
-- cannot both be true, and whichever the report reads first wins.
CREATE UNIQUE INDEX "Mandate_one_active_per_listing"
    ON "Mandate" ("listingId") WHERE "status" = 'ACTIVE';

-- A requirement belongs to somebody. Without this it is a wish nobody can act
-- on, and the demand check produces matches with no one to call.
ALTER TABLE "ClientRequirement"
    ADD CONSTRAINT "ClientRequirement_subject_check"
    CHECK ("leadId" IS NOT NULL OR "contactId" IS NOT NULL);

ALTER TABLE "ClientRequirement"
    ADD CONSTRAINT "ClientRequirement_budget_check"
    CHECK ("budgetMin" IS NULL OR "budgetMax" IS NULL OR "budgetMin" <= "budgetMax");

ALTER TABLE "ClientRequirement"
    ADD CONSTRAINT "ClientRequirement_bedrooms_check"
    CHECK ("bedroomsMin" IS NULL OR "bedroomsMax" IS NULL OR "bedroomsMin" <= "bedroomsMax");

-- ── Permissions ────────────────────────────────────────────────────────────
--
-- `listings` and `requirements` are separate modules on purpose. Stock and
-- demand are edited by different people: an agent lists a property they were
-- given, and captures what their own client wants. A single module would mean
-- granting the right to edit the agency's whole book in order to record one
-- buyer's budget.
--
-- VIEW_SENSITIVE_FIELDS on `listings` is what unmasks an owner's phone number.
-- It is granted below only to roles that already hold it on `leads`, which is
-- the platform's existing answer to "who may see a contact detail".
INSERT INTO "Permission" ("id", "module", "action", "description")
VALUES
  (gen_random_uuid()::text, 'listings', 'VIEW',                  'Browse the listing book'),
  (gen_random_uuid()::text, 'listings', 'CREATE',                'Add listings, media and mandates'),
  (gen_random_uuid()::text, 'listings', 'EDIT',                  'Amend listings and decide mandates'),
  (gen_random_uuid()::text, 'listings', 'DELETE',                'Archive listings'),
  (gen_random_uuid()::text, 'listings', 'EXPORT',                'Export the listing book'),
  (gen_random_uuid()::text, 'listings', 'VIEW_SENSITIVE_FIELDS', 'See property owner contact details'),
  (gen_random_uuid()::text, 'requirements', 'VIEW',   'See client requirements'),
  (gen_random_uuid()::text, 'requirements', 'CREATE', 'Capture a client requirement'),
  (gen_random_uuid()::text, 'requirements', 'EDIT',   'Amend a client requirement'),
  (gen_random_uuid()::text, 'requirements', 'DELETE', 'Close a client requirement')
ON CONFLICT ("module", "action") DO NOTHING;

-- listings ← projects, at the same scope. Whoever browses developer inventory
-- browses resale stock; this module is the same job with a different supplier.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'listings' AND target."action" = source."action"
WHERE source."module" = 'projects' AND source."action" IN ('VIEW', 'CREATE', 'EDIT', 'DELETE', 'EXPORT')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- The owner's phone number ← whoever may already see a lead's.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'listings' AND target."action" = 'VIEW_SENSITIVE_FIELDS'
WHERE source."module" = 'leads' AND source."action" = 'VIEW_SENSITIVE_FIELDS'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- requirements ← leads, at the same scope. A requirement is an attribute of the
-- person, and whoever may work the lead may record what they are looking for.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'requirements' AND target."action" = source."action"
WHERE source."module" = 'leads' AND source."action" IN ('VIEW', 'CREATE', 'EDIT', 'DELETE')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ── Row-level security ─────────────────────────────────────────────────────
-- Five tables, named explicitly. See the note in the M4 migration on why this
-- does not re-run the catalog-driven sweep.
DO $$
DECLARE
  target TEXT;
  covered CONSTANT TEXT[] := ARRAY['Owner', 'Listing', 'ListingMedia', 'Mandate', 'ClientRequirement'];
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
