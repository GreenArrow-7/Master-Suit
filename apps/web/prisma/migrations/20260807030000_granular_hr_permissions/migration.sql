-- Split the HR module's three permissions into the authorities they conflated.
--
-- `hrms:VIEW`, `hrms:CREATE` and `hrms:EDIT` were the whole HR authorisation
-- model, with every finer distinction derived from the scope of one of them. So:
--
--   * `hrms:VIEW` returned the entire workspace — an employee directory, every
--     attendance record, every work location — because a permission that coarse
--     has nowhere to express "your own record only";
--   * `hrms:CREATE` accepted an arbitrary employeeId on an attendance record, so
--     anyone who could add a department could also mark anyone present;
--   * `isHrAdmin`, derived from `hrms:EDIT` at ORGANIZATION scope, was the only
--     gate on identity documents. Administering HR and reading everyone's
--     passport are different powers; there was no way to grant one alone.
--
-- The backfill below is written to change nobody's effective access. Every new
-- grant is derived from a grant the role already had, at the same scope. A role
-- that could do a thing yesterday can do it today; a role that could not, still
-- cannot. What changes is that the three can now be granted apart.

-- The APPROVE action itself arrives in 20260807025000, which must land first:
-- Postgres will not use a new enum value in the transaction that created it.

-- ── New permissions ─────────────────────────────────────────────────────────
INSERT INTO "Permission" ("id", "module", "action", "description")
VALUES
  (gen_random_uuid()::text, 'employee', 'VIEW',   'Read employee records'),
  (gen_random_uuid()::text, 'employee', 'CREATE', 'Add employees to the workspace'),
  (gen_random_uuid()::text, 'employee', 'EDIT',   'Change employee records and HR configuration'),
  (gen_random_uuid()::text, 'employee', 'DELETE', 'Archive employee records'),
  (gen_random_uuid()::text, 'leave', 'APPROVE',      'Decide other people''s leave requests'),
  (gen_random_uuid()::text, 'attendance', 'APPROVE', 'Decide attendance exceptions and record attendance for others'),
  (gen_random_uuid()::text, 'hr_documents', 'VIEW_SENSITIVE_FIELDS', 'Read identity documents: passports, visas, labour cards')
ON CONFLICT ("module", "action") DO NOTHING;

-- ── Backfill, one derivation per new permission ─────────────────────────────
-- `employee:VIEW` ← `hrms:VIEW`, same scope.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'employee' AND target."action" = source."action"
WHERE source."module" = 'hrms' AND source."action" IN ('VIEW', 'CREATE', 'EDIT', 'DELETE')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- `leave:APPROVE` and `attendance:APPROVE` ← `hrms:EDIT`, same scope.
--
-- That is what `isApprover` read before this migration: TEAM and above on
-- hrms:EDIT meant "may decide for your reports". Copying the scope verbatim
-- keeps the same people approving the same requests.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON (target."module", target."action") IN (('leave', 'APPROVE'), ('attendance', 'APPROVE'))
WHERE source."module" = 'hrms' AND source."action" = 'EDIT'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- `hr_documents:VIEW_SENSITIVE_FIELDS` ← `hrms:EDIT` at ORGANIZATION only.
--
-- Narrower than the others on purpose, and it is the one place the old model was
-- *wider* than anyone would have chosen: `isHrAdmin` was ORGANIZATION-scope
-- hrms:EDIT, and that alone opened every passport scan. Granting it only where
-- that was already true preserves access exactly; separating it means a company
-- can now take it away without dismantling HR administration.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", 'ORGANIZATION', NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'hr_documents' AND target."action" = 'VIEW_SENSITIVE_FIELDS'
WHERE source."module" = 'hrms' AND source."action" = 'EDIT' AND rp."scope" = 'ORGANIZATION'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- `hrms:*` is left in place. It is no longer read by the authorisation helpers,
-- but the rows are the audit trail of what the roles used to hold, and dropping
-- them would make this migration irreversible for no benefit.
