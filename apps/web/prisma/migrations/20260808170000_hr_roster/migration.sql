-- Rostering: named people on named shifts on named dates, plus swaps.
--
-- `HrEmployeeShift` already held the standing assignment ("Amina works the early
-- shift from March"), which is what overtime detection compares against. It
-- cannot express "next Tuesday only", which is what a manager publishes and what
-- a swap moves. These tables are that.

CREATE TYPE "HrRosterSource" AS ENUM ('ROSTER', 'OVERRIDE', 'SWAP');
CREATE TYPE "HrShiftChangeKind" AS ENUM ('CHANGE', 'SWAP');
CREATE TYPE "HrShiftChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "HrRosterEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "source" "HrRosterSource" NOT NULL DEFAULT 'ROSTER',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrRosterEntry_pkey" PRIMARY KEY ("id")
);

-- Allows two different shifts on one day (a split shift) while refusing the same
-- shift twice. Genuine time overlap between different shifts needs the shift
-- times to decide, so it is caught in the service.
CREATE UNIQUE INDEX "HrRosterEntry_tenantId_employeeId_workDate_shiftId_key"
    ON "HrRosterEntry"("tenantId", "employeeId", "workDate", "shiftId");
CREATE INDEX "HrRosterEntry_tenantId_workDate_idx" ON "HrRosterEntry"("tenantId", "workDate");
CREATE INDEX "HrRosterEntry_tenantId_employeeId_workDate_idx"
    ON "HrRosterEntry"("tenantId", "employeeId", "workDate");

ALTER TABLE "HrRosterEntry" ADD CONSTRAINT "HrRosterEntry_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrRosterEntry" ADD CONSTRAINT "HrRosterEntry_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrRosterEntry" ADD CONSTRAINT "HrRosterEntry_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "HrShift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HrShiftChangeRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "HrShiftChangeKind" NOT NULL,
    "requesterId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "requestedShiftId" TEXT,
    "counterpartId" TEXT,
    "counterpartEntryId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "HrShiftChangeStatus" NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrShiftChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HrShiftChangeRequest_tenantId_status_createdAt_idx"
    ON "HrShiftChangeRequest"("tenantId", "status", "createdAt");
CREATE INDEX "HrShiftChangeRequest_tenantId_requesterId_idx"
    ON "HrShiftChangeRequest"("tenantId", "requesterId");

-- A request is either a move onto a different shift or a swap with a colleague,
-- never both — a row that is both is not interpretable by the approval path.
--
-- Deliberately *not* also requiring the matching column to be non-null. The
-- rostered day a request points at can be removed while the request is still on
-- file, and both those foreign keys are ON DELETE SET NULL, so demanding
-- presence here would turn an ordinary roster edit into a constraint violation
-- and make the entry undeletable. Which column must be set at *creation* is the
-- service's rule; what the database guarantees is that the two never disagree.
ALTER TABLE "HrShiftChangeRequest" ADD CONSTRAINT "HrShiftChangeRequest_kind_check"
  CHECK (NOT ("requestedShiftId" IS NOT NULL AND "counterpartEntryId" IS NOT NULL));

ALTER TABLE "HrShiftChangeRequest" ADD CONSTRAINT "HrShiftChangeRequest_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrShiftChangeRequest" ADD CONSTRAINT "HrShiftChangeRequest_requesterId_fkey"
    FOREIGN KEY ("requesterId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrShiftChangeRequest" ADD CONSTRAINT "HrShiftChangeRequest_counterpartId_fkey"
    FOREIGN KEY ("counterpartId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HrShiftChangeRequest" ADD CONSTRAINT "HrShiftChangeRequest_approverId_fkey"
    FOREIGN KEY ("approverId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HrShiftChangeRequest" ADD CONSTRAINT "HrShiftChangeRequest_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "HrRosterEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrShiftChangeRequest" ADD CONSTRAINT "HrShiftChangeRequest_counterpartEntryId_fkey"
    FOREIGN KEY ("counterpartEntryId") REFERENCES "HrRosterEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HrShiftChangeRequest" ADD CONSTRAINT "HrShiftChangeRequest_requestedShiftId_fkey"
    FOREIGN KEY ("requestedShiftId") REFERENCES "HrShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Permissions ─────────────────────────────────────────────────────────────
-- `shifts` already exists with the CRUD actions; only the approval authority is
-- new. Derived from `shifts:EDIT` at the same scope: whoever may already publish
-- the roster is the person who decides a request to change it. Nobody gains
-- access to anything they could not already do by editing the roster directly.
INSERT INTO "Permission" ("id", "module", "action", "description")
VALUES (gen_random_uuid()::text, 'shifts', 'APPROVE', 'Decide shift change and swap requests')
ON CONFLICT ("module", "action") DO NOTHING;

INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'shifts' AND target."action" = 'APPROVE'
WHERE source."module" = 'shifts' AND source."action" = 'EDIT'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ── Row-level security ──────────────────────────────────────────────────────
-- Scoped to the tables created here. See 20260808140000_hr_overtime for why the
-- catalog-wide sweep must not be copied into a new migration.
GRANT SELECT, INSERT, UPDATE, DELETE ON "HrRosterEntry", "HrShiftChangeRequest" TO master_saas_app;

DO $$
DECLARE
  target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['HrRosterEntry', 'HrShiftChangeRequest']
  LOOP
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
