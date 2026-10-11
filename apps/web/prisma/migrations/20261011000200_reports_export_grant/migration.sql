-- A report's CSV (GET /api/v1/reports?format=csv) now needs reports:EXPORT;
-- until now reports:VIEW was enough. Every role that can see reports today
-- keeps the file: it is granted EXPORT at the same scope, as listings took
-- VIEW_SENSITIVE_FIELDS from leads in 20260808220000. An administrator can
-- withdraw it in the role editor; a role made after this needs EXPORT ticked.
--
-- Without it, a Company Administrator created while the catalogue had no
-- reports:EXPORT row would lose the file with no way back: nobody may edit their
-- own role, or grant more than they hold.
INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'reports' AND target."action" = 'EXPORT'
WHERE source."module" = 'reports' AND source."action" = 'VIEW'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
