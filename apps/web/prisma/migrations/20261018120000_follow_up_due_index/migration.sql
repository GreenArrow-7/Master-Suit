-- The Follow-ups list across a workspace (an ORGANIZATION reader, or a team
-- reaching several owners) is ordered by due date: no index served that order,
-- so each page sorted every open follow-up. At 1,000,000 leads (200,000
-- follow-ups) its p95 was 307 ms against a 300 ms target (NFR-10,
-- changes/2026-10-18-mobile-offline-rtl-audit.md). Additive.

CREATE INDEX "FollowUpTask_tenantId_dueAt_idx" ON "FollowUpTask"("tenantId", "dueAt");
