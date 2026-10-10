-- A lead's main phone and email now follow leads:VIEW_SENSITIVE_FIELDS (M2-06):
-- a role without it sees them masked. Until now that permission reached nobody
-- (the check read `lead:`, which no role can hold), so every role that reads
-- leads saw them whole. Every such role keeps seeing them, at the scope it reads
-- leads at; an administrator masks a role by switching the permission off in
-- Roles & permissions. Grants only: nothing is revoked or narrowed.

INSERT INTO "Permission" ("id", "module", "action", "description")
VALUES (gen_random_uuid()::text, 'leads', 'VIEW_SENSITIVE_FIELDS', 'See a lead''s phone numbers and email unmasked')
ON CONFLICT ("module", "action") DO NOTHING;

INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", true, rp."scope", NOW()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId"
JOIN "Permission" target ON target."module" = 'leads' AND target."action" = 'VIEW_SENSITIVE_FIELDS'
WHERE source."module" = 'leads' AND source."action" = 'VIEW'
  AND rp."granted" AND rp."scope" <> 'NONE'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
