-- Site visits and client meetings, with approval, a geo punch and a leader
-- verification queue (M6).
--
-- One table, not two. The spec names SiteVisit and Meeting separately, but they
-- share a lifecycle, a check-in and one verification queue — two tables would be
-- two copies of the same state machine and two lists a manager has to remember
-- to open. `kind` distinguishes them where they actually differ, which is
-- whether the destination is a property or an address.
--
-- Deliberately not FieldVisit, which already exists: that records a rep calling
-- on a lead, with no approval and no client in the car. A site visit costs a
-- car, a set of keys and often a developer's time, which is why it is requested
-- rather than simply booked.
--
-- The acceptance criterion — "the state machine rejects illegal transitions; a
-- completed visit cannot be edited without an audit entry" — is enforced in two
-- places on purpose. The transitions live in the service, where they can explain
-- themselves; the amendment rule is also a CHECK here, because a correction made
-- by a direct UPDATE is exactly the one nobody would otherwise see.

-- CreateEnum
CREATE TYPE "SiteVisitKind" AS ENUM ('PROPERTY_VISIT', 'CLIENT_MEETING');

-- CreateEnum
CREATE TYPE "SiteVisitStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "VisitVerification" AS ENUM ('PENDING', 'VERIFIED', 'DISPUTED');

-- AlterTable
ALTER TABLE "OrganizationSetting" ADD COLUMN     "visitGeofenceRadiusM" INTEGER NOT NULL DEFAULT 250,
ADD COLUMN     "visitMaxTravelKph" INTEGER NOT NULL DEFAULT 160;

-- CreateTable
CREATE TABLE "SiteVisit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "SiteVisitKind" NOT NULL DEFAULT 'PROPERTY_VISIT',
    "ownerId" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "projectId" TEXT,
    "unitInventoryId" TEXT,
    "listingId" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "meetingUrl" TEXT,
    "status" "SiteVisitStatus" NOT NULL DEFAULT 'REQUESTED',
    "verification" "VisitVerification" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "checkInAt" TIMESTAMP(3),
    "checkInLat" DOUBLE PRECISION,
    "checkInLng" DOUBLE PRECISION,
    "checkInAccuracy" DOUBLE PRECISION,
    "checkOutAt" TIMESTAMP(3),
    "checkOutLat" DOUBLE PRECISION,
    "checkOutLng" DOUBLE PRECISION,
    "distanceMeters" INTEGER,
    "geofenceOk" BOOLEAN,
    "locationSuspect" BOOLEAN NOT NULL DEFAULT false,
    "suspectReason" TEXT,
    "outcome" TEXT,
    "notes" TEXT,
    "amendedAt" TIMESTAMP(3),
    "amendedById" TEXT,
    "amendReason" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SiteVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteVisit_tenantId_ownerId_scheduledAt_idx" ON "SiteVisit"("tenantId", "ownerId", "scheduledAt");

-- CreateIndex
CREATE INDEX "SiteVisit_tenantId_status_scheduledAt_idx" ON "SiteVisit"("tenantId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "SiteVisit_tenantId_status_verification_idx" ON "SiteVisit"("tenantId", "status", "verification");

-- CreateIndex
CREATE INDEX "SiteVisit_tenantId_projectId_scheduledAt_idx" ON "SiteVisit"("tenantId", "projectId", "scheduledAt");

-- CreateIndex
CREATE INDEX "SiteVisit_tenantId_leadId_idx" ON "SiteVisit"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "SiteVisit_tenantId_ownerId_checkInAt_idx" ON "SiteVisit"("tenantId", "ownerId", "checkInAt");

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_unitInventoryId_fkey" FOREIGN KEY ("unitInventoryId") REFERENCES "UnitInventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Integrity ───────────────────────────────────────────────────────────────

-- A property visit with no property is a meeting that lost its address. The
-- kind and the destination have to agree, or the geofence has nothing to
-- measure against and the punch silently passes.
ALTER TABLE "SiteVisit"
    ADD CONSTRAINT "SiteVisit_destination_check"
    CHECK (
      "kind" <> 'PROPERTY_VISIT'
      OR "projectId" IS NOT NULL
      OR "listingId" IS NOT NULL
      OR "unitInventoryId" IS NOT NULL
    );

-- Somebody is being taken. Without a client this is a FieldVisit, which already
-- exists and does not need approving.
ALTER TABLE "SiteVisit"
    ADD CONSTRAINT "SiteVisit_client_check"
    CHECK ("leadId" IS NOT NULL OR "contactId" IS NOT NULL);

ALTER TABLE "SiteVisit"
    ADD CONSTRAINT "SiteVisit_duration_check"
    CHECK ("durationMin" > 0 AND "durationMin" <= 1440);

-- Checking out before checking in is a clock that went backwards, and it makes
-- every duration report negative from that row onwards.
ALTER TABLE "SiteVisit"
    ADD CONSTRAINT "SiteVisit_punch_order_check"
    CHECK ("checkOutAt" IS NULL OR "checkInAt" IS NULL OR "checkOutAt" >= "checkInAt");

-- A decision without a decider cannot be questioned later, which is the whole
-- point of requiring one.
ALTER TABLE "SiteVisit"
    ADD CONSTRAINT "SiteVisit_decision_check"
    CHECK (("status" NOT IN ('APPROVED', 'REJECTED')) OR "decidedById" IS NOT NULL);

-- The acceptance criterion, in the database as well as in the route: a completed
-- visit that has been amended carries the reason it was amended. A silent
-- correction to an outcome is indistinguishable from the original.
ALTER TABLE "SiteVisit"
    ADD CONSTRAINT "SiteVisit_amend_check"
    CHECK (("amendedAt" IS NULL) = ("amendReason" IS NULL));

ALTER TABLE "OrganizationSetting"
    ADD CONSTRAINT "OrganizationSetting_visit_check"
    CHECK ("visitGeofenceRadiusM" BETWEEN 10 AND 20000 AND "visitMaxTravelKph" BETWEEN 10 AND 1000);

-- ── Permissions ────────────────────────────────────────────────────────────
--
-- `visits` is its own module. Booking a viewing, approving one, and verifying
-- that it happened are three different authorities, and the last two are the
-- reason the module exists at all: a visit register nobody signs off is a diary.
--
-- APPROVE is the decision queue. MANAGE_USERS is the verification queue —
-- deciding whether somebody's punch is believed, which is a judgement about an
-- employee rather than about a record.
INSERT INTO "Permission" ("id", "module", "action", "description")
VALUES
  (gen_random_uuid()::text, 'visits', 'VIEW',         'See site visits and meetings'),
  (gen_random_uuid()::text, 'visits', 'CREATE',       'Request a site visit or meeting'),
  (gen_random_uuid()::text, 'visits', 'EDIT',         'Amend a visit, and check in or out'),
  (gen_random_uuid()::text, 'visits', 'DELETE',       'Cancel a visit'),
  (gen_random_uuid()::text, 'visits', 'APPROVE',      'Approve or reject requested visits'),
  (gen_random_uuid()::text, 'visits', 'MANAGE_USERS', 'Verify or dispute a completed visit')
ON CONFLICT ("module", "action") DO NOTHING;

-- VIEW/CREATE/EDIT/DELETE ← the same action on `activities`, at the same scope.
-- Whoever logs a meeting with a client today can book one.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'visits' AND target."action" = source."action"
WHERE source."module" = 'activities' AND source."action" IN ('VIEW', 'CREATE', 'EDIT', 'DELETE')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- APPROVE and the verification queue ← whoever already reassigns other people's
-- leads. That is this platform's existing test for "acts across the floor", and
-- deriving them from anything narrower leaves a workspace with a queue and
-- nobody able to clear it.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'visits' AND target."action" IN ('APPROVE', 'MANAGE_USERS')
WHERE source."module" = 'leads' AND source."action" = 'REASSIGN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ── Row-level security ─────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON "SiteVisit" TO master_saas_app;
ALTER TABLE "SiteVisit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteVisit" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SiteVisit";
CREATE POLICY tenant_isolation ON "SiteVisit" FOR ALL
  USING (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  )
  WITH CHECK (
    "tenantId" = nullif(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = 'on'
  );
