-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Meetings reuse the call pipeline.
--    A recorded meeting is a Call linked to an Event, so consent → recording →
--    transcript → Gemini analysis all work unchanged. One nullable column beats
--    a parallel MeetingRecording/MeetingConsent/MeetingSummary tower.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "eventId" TEXT;
CREATE INDEX IF NOT EXISTS "Call_tenantId_eventId_createdAt_idx"
  ON "Call" ("tenantId", "eventId", "createdAt" DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Root cause: the "calls" and "events" modules used by /api/v1/calls/**,
--    /api/v1/events/** and /api/v1/campaigns/** were never inserted into the
--    Permission catalogue. assertPermission() therefore denied those routes for
--    every role — including super_admin, whose '*' grant only expands over rows
--    that exist. Insert the catalogue rows, then mirror each role's existing
--    "leads" grant so scopes (OWN/TEAM/REGION/ORGANIZATION) stay as configured
--    and read-only roles stay read-only.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "Permission" ("id", "module", "action")
SELECT gen_random_uuid()::text, m.module, a.action::"PermissionAction"
FROM (VALUES ('calls'), ('events')) AS m(module)
CROSS JOIN (VALUES
  ('VIEW'), ('CREATE'), ('EDIT'), ('DELETE'), ('EXPORT'),
  ('IMPORT'), ('ASSIGN'), ('REASSIGN'), ('BULK_UPDATE'), ('VIEW_SENSITIVE_FIELDS')
) AS a(action)
ON CONFLICT ("module", "action") DO NOTHING;

INSERT INTO "RolePermission" ("id", "tenantId", "roleId", "permissionId", "granted", "scope", "updatedAt")
SELECT gen_random_uuid()::text, rp."tenantId", rp."roleId", target."id", rp."granted", rp."scope", now()
FROM "RolePermission" rp
JOIN "Permission" source ON source."id" = rp."permissionId" AND source."module" = 'leads'
JOIN "Permission" target ON target."action" = source."action" AND target."module" IN ('calls', 'events')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
