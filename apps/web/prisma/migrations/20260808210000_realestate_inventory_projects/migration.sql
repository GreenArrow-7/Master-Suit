-- Real-estate inventory: projects, unit plans and live unit availability (M4).
--
-- The first genuinely new domain in this codebase. Leads, opportunities, calls
-- and campaigns were already here; what a property salesperson pitches *from*
-- was not. Eight tables, and the shape of them is decided by one requirement:
-- the catalogue answers every list route under 400 ms at 100k projects, using
-- Postgres indexes rather than a search engine.
--
-- Two consequences of that requirement are visible in the schema. The price
-- band and the unit counters are denormalised onto Project, because a
-- correlated aggregate per row is exactly what makes a catalogue slow. And the
-- multi-select facets are arrays with GIN indexes rather than join tables,
-- because "has any of these amenities" over a join is a second index scan per
-- facet.
--
-- Inventory is reference data, not owned records: there is no ownerId and no
-- visibility scoping on read. Every RM sees the whole catalogue, which is the
-- point of a catalogue. Only the write actions are permission-gated.

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED', 'PRE_LAUNCH', 'LAUNCHED', 'UNDER_CONSTRUCTION', 'READY', 'SOLD_OUT', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "PossessionStatus" AS ENUM ('READY_TO_MOVE', 'UNDER_CONSTRUCTION', 'NEW_LAUNCH');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('AVAILABLE', 'HELD', 'BOOKED', 'SOLD', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ProjectMediaKind" AS ENUM ('IMAGE', 'FLOOR_PLAN', 'BROCHURE', 'CREATIVE', 'VIDEO', 'VR_TOUR');

-- CreateTable
CREATE TABLE "Developer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "about" TEXT,
    "logoUrl" TEXT,
    "reraId" TEXT,
    "establishedYear" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Developer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Micromarket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'AE',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Micromarket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Amenity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Amenity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "developerId" TEXT,
    "micromarketId" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'LAUNCHED',
    "possessionStatus" "PossessionStatus" NOT NULL DEFAULT 'UNDER_CONSTRUCTION',
    "possessionAt" TIMESTAMP(3),
    "minPrice" DECIMAL(18,2),
    "maxPrice" DECIMAL(18,2),
    "pricePerSqft" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "minAreaSqft" INTEGER,
    "maxAreaSqft" INTEGER,
    "unitTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "amenityKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "description" TEXT,
    "reraNumber" TEXT,
    "reraAuthority" TEXT,
    "reraApprovedAt" TIMESTAMP(3),
    "reraExpiresAt" TIMESTAMP(3),
    "totalUnits" INTEGER NOT NULL DEFAULT 0,
    "availableUnits" INTEGER NOT NULL DEFAULT 0,
    "soldUnits" INTEGER NOT NULL DEFAULT 0,
    "isPriority" BOOLEAN NOT NULL DEFAULT false,
    "isPitchable" BOOLEAN NOT NULL DEFAULT true,
    "launchedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMedia" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "ProjectMediaKind" NOT NULL DEFAULT 'IMAGE',
    "title" TEXT,
    "storageKey" TEXT,
    "externalUrl" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ProjectMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "carpetAreaSqft" INTEGER,
    "builtUpAreaSqft" INTEGER,
    "price" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "floorPlanKey" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "UnitPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitInventory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "unitPlanId" TEXT,
    "tower" TEXT,
    "floor" INTEGER,
    "unitNumber" TEXT NOT NULL,
    "status" "UnitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "price" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "areaSqft" INTEGER,
    "facing" TEXT,
    "heldById" TEXT,
    "heldUntil" TIMESTAMP(3),
    "leadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "UnitInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFavourite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectFavourite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Developer_tenantId_isActive_name_idx" ON "Developer"("tenantId", "isActive", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Developer_tenantId_name_key" ON "Developer"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Micromarket_tenantId_isActive_city_name_idx" ON "Micromarket"("tenantId", "isActive", "city", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Micromarket_tenantId_city_name_key" ON "Micromarket"("tenantId", "city", "name");

-- CreateIndex
CREATE INDEX "Amenity_tenantId_category_position_idx" ON "Amenity"("tenantId", "category", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Amenity_tenantId_key_key" ON "Amenity"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Project_tenantId_deletedAt_updatedAt_id_idx" ON "Project"("tenantId", "deletedAt", "updatedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "Project_tenantId_micromarketId_status_idx" ON "Project"("tenantId", "micromarketId", "status");

-- CreateIndex
CREATE INDEX "Project_tenantId_developerId_status_idx" ON "Project"("tenantId", "developerId", "status");

-- CreateIndex
CREATE INDEX "Project_tenantId_possessionStatus_possessionAt_idx" ON "Project"("tenantId", "possessionStatus", "possessionAt");

-- CreateIndex
CREATE INDEX "Project_tenantId_status_minPrice_idx" ON "Project"("tenantId", "status", "minPrice");

-- CreateIndex
CREATE INDEX "Project_tenantId_isPitchable_isPriority_idx" ON "Project"("tenantId", "isPitchable", "isPriority");

-- CreateIndex
CREATE UNIQUE INDEX "Project_tenantId_code_key" ON "Project"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ProjectMedia_tenantId_projectId_kind_position_idx" ON "ProjectMedia"("tenantId", "projectId", "kind", "position");

-- CreateIndex
CREATE INDEX "UnitPlan_tenantId_projectId_position_idx" ON "UnitPlan"("tenantId", "projectId", "position");

-- CreateIndex
CREATE INDEX "UnitPlan_tenantId_unitType_idx" ON "UnitPlan"("tenantId", "unitType");

-- CreateIndex
CREATE INDEX "UnitInventory_tenantId_projectId_status_idx" ON "UnitInventory"("tenantId", "projectId", "status");

-- CreateIndex
CREATE INDEX "UnitInventory_tenantId_status_heldUntil_idx" ON "UnitInventory"("tenantId", "status", "heldUntil");

-- CreateIndex
CREATE UNIQUE INDEX "UnitInventory_projectId_unitNumber_key" ON "UnitInventory"("projectId", "unitNumber");

-- CreateIndex
CREATE INDEX "ProjectFavourite_tenantId_userId_idx" ON "ProjectFavourite"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFavourite_projectId_userId_key" ON "ProjectFavourite"("projectId", "userId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_developerId_fkey" FOREIGN KEY ("developerId") REFERENCES "Developer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_micromarketId_fkey" FOREIGN KEY ("micromarketId") REFERENCES "Micromarket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMedia" ADD CONSTRAINT "ProjectMedia_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitPlan" ADD CONSTRAINT "UnitPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitInventory" ADD CONSTRAINT "UnitInventory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitInventory" ADD CONSTRAINT "UnitInventory_unitPlanId_fkey" FOREIGN KEY ("unitPlanId") REFERENCES "UnitPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFavourite" ADD CONSTRAINT "ProjectFavourite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Search and facet indexes ────────────────────────────────────────────────
--
-- The acceptance criterion for this module is a 100k-row catalogue answering
-- every list route under 400 ms, using Postgres and not a search engine. The
-- btree indexes above cover the facets and the keyset sort. These three cover
-- what btree cannot.

-- Name search. `name ILIKE '%marina%'` cannot use a btree index at all — it is a
-- sequential scan over every project in the workspace, which is precisely the
-- query a salesperson types first. A trigram GIN index makes it an index scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Project_name_trgm_idx" ON "Project" USING gin ("name" gin_trgm_ops);

-- Array containment. `amenityKeys @> ARRAY['pool']` and `unitTypes && ARRAY['2BHK']`
-- are the two multi-select facets; GIN is the only index that serves them.
CREATE INDEX "Project_amenityKeys_idx" ON "Project" USING gin ("amenityKeys");
CREATE INDEX "Project_unitTypes_idx" ON "Project" USING gin ("unitTypes");

-- Live inventory is filtered to what is actually sellable far more often than
-- it is counted in full. Partial index, so it stays small as sold stock grows.
CREATE INDEX "UnitInventory_available_idx"
    ON "UnitInventory" ("tenantId", "projectId")
    WHERE "status" = 'AVAILABLE';

-- ── Integrity the application must not be the only one enforcing ────────────
--
-- A price band that runs backwards produces a catalogue filter that silently
-- matches nothing, and it is the kind of thing a bulk import gets wrong once.
ALTER TABLE "Project"
    ADD CONSTRAINT "Project_price_band_check"
    CHECK ("minPrice" IS NULL OR "maxPrice" IS NULL OR "minPrice" <= "maxPrice");

ALTER TABLE "Project"
    ADD CONSTRAINT "Project_area_band_check"
    CHECK ("minAreaSqft" IS NULL OR "maxAreaSqft" IS NULL OR "minAreaSqft" <= "maxAreaSqft");

-- The denormalised counters are the thing most likely to drift, and a negative
-- one is proof that it has. Cheap to check, and it fails the transaction that
-- did it rather than the report that reads it a week later.
ALTER TABLE "Project"
    ADD CONSTRAINT "Project_unit_counts_check"
    CHECK (
      "totalUnits" >= 0 AND "availableUnits" >= 0 AND "soldUnits" >= 0
      AND "availableUnits" + "soldUnits" <= "totalUnits"
    );

-- A held unit without an expiry is indistinguishable from a sold one a week
-- later, so the hold has to carry its clock.
ALTER TABLE "UnitInventory"
    ADD CONSTRAINT "UnitInventory_hold_check"
    CHECK ("status" <> 'HELD' OR "heldUntil" IS NOT NULL);

-- ── Permissions ────────────────────────────────────────────────────────────
--
-- `projects` is its own module rather than a reuse of `products`. Inventory is
-- reference data every salesperson must see in full to pitch it, while the
-- right to *edit* it belongs to ops — a distinction `products` does not draw,
-- because a product catalogue is not something an RM browses by micromarket.
--
-- The backfill below is written to change nobody's effective access: every
-- grant is derived from one the role already held on `products`, at the same
-- scope. What it does not do is grant VIEW to roles that had none, so a
-- workspace that hid the product catalogue from a role keeps it hidden here.
INSERT INTO "Permission" ("id", "module", "action", "description")
VALUES
  (gen_random_uuid()::text, 'projects', 'VIEW',    'Browse the project inventory'),
  (gen_random_uuid()::text, 'projects', 'CREATE',  'Add projects, unit plans and units'),
  (gen_random_uuid()::text, 'projects', 'EDIT',    'Amend projects, pricing, media and unit status'),
  (gen_random_uuid()::text, 'projects', 'DELETE',  'Archive projects'),
  (gen_random_uuid()::text, 'projects', 'EXPORT',  'Export the catalogue')
ON CONFLICT ("module", "action") DO NOTHING;

INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'projects' AND target."action" = source."action"
WHERE source."module" = 'products' AND source."action" IN ('VIEW', 'CREATE', 'EDIT', 'DELETE', 'EXPORT')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ── Row-level security ─────────────────────────────────────────────────────
--
-- Scoped to the seven tables this migration creates, named explicitly. The
-- catalog-driven sweep in 20260803230000_rls_full_coverage carries a bootstrap
-- exclusion list that is a moving target; re-running a stale copy is how
-- WorkspaceInvitation lost its bootstrap exemption once already. A migration
-- that adds seven tables only needs policies on seven tables.
DO $$
DECLARE
  target TEXT;
  covered CONSTANT TEXT[] := ARRAY[
    'Developer', 'Micromarket', 'Amenity', 'Project', 'ProjectMedia', 'UnitPlan',
    'UnitInventory', 'ProjectFavourite'
  ];
BEGIN
  FOREACH target IN ARRAY covered LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO master_saas_app', target);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    -- FORCE, because the migration role owns these tables and an owner bypasses
    -- RLS unconditionally without it — no role attribute reveals that.
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
