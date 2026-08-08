-- Overtime: claims, decisions, and the permission that decides them.
--
-- Attendance already knew how long people worked and payroll will need to know
-- what to pay for it, but nothing connected the two. This adds the missing step:
-- a claim that a human approves before it can reach a payslip.

-- ── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE "HrOvertimeSource" AS ENUM ('DETECTED', 'REQUESTED');
CREATE TYPE "HrOvertimeKind" AS ENUM ('NORMAL', 'NIGHT', 'WEEKEND', 'HOLIDAY');
CREATE TYPE "HrOvertimeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- ── Claims ──────────────────────────────────────────────────────────────────
CREATE TABLE "HrOvertimeRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "kind" "HrOvertimeKind" NOT NULL,
    "source" "HrOvertimeSource" NOT NULL,
    "status" "HrOvertimeStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    -- Resolved at approval and never re-read, so a later rate change cannot
    -- restate an already-approved payout.
    "multiplier" DOUBLE PRECISION,
    "compensatory" BOOLEAN NOT NULL DEFAULT false,
    "requestedById" TEXT,
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "lockedAt" TIMESTAMP(3),
    "payrollRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrOvertimeRequest_pkey" PRIMARY KEY ("id")
);

-- Idempotency for detection, and one manual claim per person per day. Re-running
-- a scan over an already-scanned week updates rather than stacking a duplicate.
CREATE UNIQUE INDEX "HrOvertimeRequest_tenantId_employeeId_workDate_source_key"
    ON "HrOvertimeRequest"("tenantId", "employeeId", "workDate", "source");
CREATE INDEX "HrOvertimeRequest_tenantId_status_workDate_idx"
    ON "HrOvertimeRequest"("tenantId", "status", "workDate");
CREATE INDEX "HrOvertimeRequest_tenantId_employeeId_workDate_idx"
    ON "HrOvertimeRequest"("tenantId", "employeeId", "workDate");

-- A claim's minutes must be a sane quantity of a day's work. Enforced here as
-- well as in the service, because a direct SQL correction bypasses the service.
ALTER TABLE "HrOvertimeRequest"
    ADD CONSTRAINT "HrOvertimeRequest_minutes_check" CHECK ("minutes" > 0 AND "minutes" <= 1440);

ALTER TABLE "HrOvertimeRequest" ADD CONSTRAINT "HrOvertimeRequest_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrOvertimeRequest" ADD CONSTRAINT "HrOvertimeRequest_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HrOvertimeRequest" ADD CONSTRAINT "HrOvertimeRequest_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "HrOvertimeRequest" ADD CONSTRAINT "HrOvertimeRequest_approverId_fkey"
    FOREIGN KEY ("approverId") REFERENCES "EmployeeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── The permission ──────────────────────────────────────────────────────────
-- `overtime` is its own module rather than a reuse of `attendance`, because
-- correcting a timesheet and committing money are different authorities. The
-- backfill below is written to change nobody's effective access: every grant is
-- derived from one the role already held, at the same scope.
INSERT INTO "Permission" ("id", "module", "action", "description")
VALUES
  (gen_random_uuid()::text, 'overtime', 'VIEW',    'Read overtime claims'),
  (gen_random_uuid()::text, 'overtime', 'CREATE',  'Raise an overtime claim'),
  (gen_random_uuid()::text, 'overtime', 'EDIT',    'Amend overtime claims and run detection'),
  (gen_random_uuid()::text, 'overtime', 'DELETE',  'Withdraw overtime claims'),
  (gen_random_uuid()::text, 'overtime', 'APPROVE', 'Decide other people''s overtime claims')
ON CONFLICT ("module", "action") DO NOTHING;

-- VIEW/CREATE/EDIT/DELETE ← the same action on `attendance`, same scope. Someone
-- who could already see a team's attendance can see the overtime derived from it.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'overtime' AND target."action" = source."action"
WHERE source."module" = 'attendance' AND source."action" IN ('VIEW', 'CREATE', 'EDIT', 'DELETE')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- APPROVE ← `attendance:APPROVE`, same scope.
--
-- This is the one grant that hands out a new power: whoever decides attendance
-- exceptions today will decide overtime tomorrow. Deriving it from anything
-- narrower would leave every existing workspace with an approval queue and
-- nobody able to clear it, which is worse than a conservative default nobody
-- notices. A workspace that wants the two split can now revoke this row — which
-- is the point of making it a separate permission.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'overtime' AND target."action" = 'APPROVE'
WHERE source."module" = 'attendance' AND source."action" = 'APPROVE'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ── Row-level security ──────────────────────────────────────────────────────
-- Same catalog-driven block as 20260803230000_rls_full_coverage. Re-running it
-- covers the table created above; without it, HrOvertimeRequest would be the
-- only HR table without a tenant_isolation policy.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO master_saas_app;

DO $$
DECLARE
  target TEXT;
  bootstrap CONSTANT TEXT[] := ARRAY[
    'Session', 'PlatformSession', 'APIKey', 'IntegrationConnection',
    'PasswordResetToken', 'RateLimitCounter',
    'RecordingConsent', 'Recording', 'Transcript', 'AIAnalysis', 'CallAudit',
    'PlatformUser', 'WorkspaceMembership', 'PlatformAuditEvent', 'AuthenticationFactor'
  ];
BEGIN
  FOR target IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN pg_tables t ON t.tablename = c.table_name AND t.schemaname = 'public'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenantId'
      AND NOT (c.table_name = ANY (bootstrap))
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO master_saas_app '
      'USING ("tenantId" = nullif(current_setting(''app.tenant_id'', true), '''')) '
      'WITH CHECK ("tenantId" = nullif(current_setting(''app.tenant_id'', true), ''''))',
      target
    );
  END LOOP;
END $$;
