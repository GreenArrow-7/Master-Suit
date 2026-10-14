-- The lead keys added in 20261016120000 look calls and site visits up by the
-- lead alone when a lead is deleted (ON DELETE SET NULL). The tenant-first
-- indexes cannot serve that, so each deleted lead scanned the calls. Deleting
-- the 100,000-lead test workspace in one statement ran 25 minutes before it
-- was rolled back. Additive.

CREATE INDEX "Call_leadId_idx" ON "Call"("leadId");

CREATE INDEX "SiteVisit_leadId_idx" ON "SiteVisit"("leadId");
