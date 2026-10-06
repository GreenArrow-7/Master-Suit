-- Workspaces that work leads (Sales, Real Estate, Lead Eagle) but were created
-- without Sales got no lead stages, activity types or task types: the wizard
-- provisioned them for Sales alone, so such a workspace could not take its first
-- lead ("Lead stage not found"). New workspaces now get them at creation
-- (services/platform/provisioning.ts); this repairs the ones that already exist,
-- with the same starting lists, list by list, and only where a list is empty —
-- a workspace that has made its own keeps it.

INSERT INTO "LeadStage" ("id", "tenantId", "key", "name", "position", "isDefault", "category", "updatedAt")
SELECT gen_random_uuid()::text, t."id", s.key, s.name, s.position, s.is_default, s.category::"StageCategory", now()
FROM "Tenant" t
CROSS JOIN (VALUES
  ('new', 'New', 1, true, 'OPEN'),
  ('qualified', 'Qualified', 2, false, 'OPEN'),
  ('won', 'Won', 3, false, 'CONVERSION'),
  ('lost', 'Lost', 4, false, 'TERMINAL_NEGATIVE')
) AS s(key, name, position, is_default, category)
WHERE t."deletedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "ModuleEntitlement" e
    WHERE e."tenantId" = t."id" AND e."module" IN ('SALES', 'REAL_ESTATE', 'LEAD_EAGLE') AND e."state" <> 'CANCELED'
  )
  AND NOT EXISTS (SELECT 1 FROM "LeadStage" x WHERE x."tenantId" = t."id")
ON CONFLICT DO NOTHING;

INSERT INTO "ActivityType" ("id", "tenantId", "key", "name", "scoreDelta", "position", "updatedAt")
SELECT gen_random_uuid()::text, t."id", a.key, a.name, a.score_delta, a.position, now()
FROM "Tenant" t
CROSS JOIN (VALUES
  ('call_out', 'Outbound call', 3, 0),
  ('call_in', 'Incoming call', 8, 1),
  ('email_sent', 'Email sent', 1, 2),
  ('meeting', 'Meeting', 12, 3),
  ('follow_up', 'Follow-up completed', 3, 4),
  ('note', 'Lead note', 0, 5)
) AS a(key, name, score_delta, position)
WHERE t."deletedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "ModuleEntitlement" e
    WHERE e."tenantId" = t."id" AND e."module" IN ('SALES', 'REAL_ESTATE', 'LEAD_EAGLE') AND e."state" <> 'CANCELED'
  )
  AND NOT EXISTS (SELECT 1 FROM "ActivityType" x WHERE x."tenantId" = t."id")
ON CONFLICT DO NOTHING;

INSERT INTO "TaskType" ("id", "tenantId", "key", "name", "category", "updatedAt")
SELECT gen_random_uuid()::text, t."id", k.key, k.name, k.category::"TaskCategory", now()
FROM "Tenant" t
CROSS JOIN (VALUES
  ('call', 'Call', 'TODO'),
  ('meeting', 'Meeting', 'APPOINTMENT'),
  ('follow_up', 'Follow-up', 'TODO'),
  ('internal', 'Internal task', 'TODO')
) AS k(key, name, category)
WHERE t."deletedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "ModuleEntitlement" e
    WHERE e."tenantId" = t."id" AND e."module" IN ('SALES', 'REAL_ESTATE', 'LEAD_EAGLE') AND e."state" <> 'CANCELED'
  )
  AND NOT EXISTS (SELECT 1 FROM "TaskType" x WHERE x."tenantId" = t."id")
ON CONFLICT DO NOTHING;
