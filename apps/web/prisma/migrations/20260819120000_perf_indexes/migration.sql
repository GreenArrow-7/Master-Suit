-- Hot-path indexes surfaced by the navigation-latency audit (2026-08-19).
--
-- Team(parentTeamId):      descendantTeamIds walks the tree one level at a time
--                          with `parentTeamId IN (frontier)`; without this each
--                          level is a sequential scan, on every TEAM-scoped read.
-- Call(startedAt):         the dashboard's "calls today" count filters a
--                          startedAt range.
-- CallAudit(status, ...):  the dashboard's three audit counts and the score
--                          aggregate filter on status / humanReviewed.
-- Lead(ownerId, updatedAt): an OWN/TEAM-scoped rep's default list is
--                          `ownerId IN (...) ORDER BY updatedAt DESC`.

CREATE INDEX "Team_tenantId_parentTeamId_idx" ON "Team"("tenantId", "parentTeamId");

CREATE INDEX "Call_tenantId_startedAt_idx" ON "Call"("tenantId", "startedAt");

CREATE INDEX "CallAudit_tenantId_status_humanReviewed_idx" ON "CallAudit"("tenantId", "status", "humanReviewed");

CREATE INDEX "Lead_tenantId_ownerId_updatedAt_idx" ON "Lead"("tenantId", "ownerId", "updatedAt" DESC);
