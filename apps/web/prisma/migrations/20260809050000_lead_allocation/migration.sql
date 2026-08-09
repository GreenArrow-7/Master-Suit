-- M7 tail — lead allocation, allocation requests, cross-segment routing.
--
-- Almost no new schema. Leads already have an owner, LeadAssignmentHistory
-- already records who moved what and why, and User already carries
-- dailyLeadQuota, weeklyLeadQuota, monthlyLeadQuota and activeLeadCapacity.
--
-- Those four columns had never been read by anything. DistributionRule
-- advertises `respectQuotas` and `respectCapacity`, and the assigner ignored
-- both — so a workspace could configure a limit and watch it do nothing. The
-- work in this module is enforcing them; the only new table is an agent asking
-- for more work.

-- CreateEnum
CREATE TYPE "AllocationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AllocationRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "requested" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "AllocationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "allocatedCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AllocationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AllocationRequest_tenantId_status_createdAt_idx" ON "AllocationRequest"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AllocationRequest_tenantId_requesterId_status_idx" ON "AllocationRequest"("tenantId", "requesterId", "status");

-- ── Constraints the datamodel cannot express ───────────────────────────────

-- Asking for nothing, or for the entire database, are both mistakes rather than
-- requests. The upper bound is a sanity rail, not a policy — quotas do the real
-- limiting, and they live on User.
ALTER TABLE "AllocationRequest"
    ADD CONSTRAINT "AllocationRequest_requested_check"
    CHECK ("requested" >= 1 AND "requested" <= 5000);

-- A decided request records who decided and when, or it is still pending.
ALTER TABLE "AllocationRequest"
    ADD CONSTRAINT "AllocationRequest_decided_check"
    CHECK (
      ("status" = 'PENDING' AND "decidedById" IS NULL AND "decidedAt" IS NULL)
      OR ("status" <> 'PENDING' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
    );

-- Only an approved request hands anything over, and it must say how much.
-- Approving with no count recorded is how "I asked and got nothing" becomes
-- indistinguishable from "nobody has looked at it".
ALTER TABLE "AllocationRequest"
    ADD CONSTRAINT "AllocationRequest_allocated_check"
    CHECK (("status" = 'APPROVED') = ("allocatedCount" IS NOT NULL));

-- One open request per person. A queue of five "I need more leads" from the
-- same agent is noise a leader has to triage, and approving two of them
-- allocates twice.
CREATE UNIQUE INDEX "AllocationRequest_one_open_per_requester"
    ON "AllocationRequest" ("tenantId", "requesterId")
    WHERE "status" = 'PENDING' AND "deletedAt" IS NULL;

-- ── Permissions ────────────────────────────────────────────────────────────
INSERT INTO "Permission" ("id", "module", "action", "description") VALUES
  (gen_random_uuid()::text, 'allocation', 'VIEW',    'See allocation requests and pool depth'),
  (gen_random_uuid()::text, 'allocation', 'CREATE',  'Ask for more leads'),
  (gen_random_uuid()::text, 'allocation', 'APPROVE', 'Allocate leads and decide requests')
ON CONFLICT ("module", "action") DO NOTHING;

-- Anybody who works leads may ask for more of them.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'allocation' AND target."action" IN ('VIEW', 'CREATE')
WHERE source."module" = 'leads' AND source."action" = 'VIEW'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Handing work out is derived from already being allowed to hand work out.
-- APPROVE is not given to everybody who can read a lead.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'allocation' AND target."action" = 'APPROVE'
WHERE source."module" = 'leads' AND source."action" = 'ASSIGN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ── Row-level security ─────────────────────────────────────────────────────
DO $$
DECLARE
  target TEXT;
  covered CONSTANT TEXT[] := ARRAY['AllocationRequest'];
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
