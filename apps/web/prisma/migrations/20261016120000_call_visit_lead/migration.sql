-- M3-17: a call and a site visit name their lead as a relation, so the Lead
-- Eagle board and its lists can filter them by the lead's source and project.
-- Additive. NOT VALID: the key holds for every new or changed row without
-- scanning, or refusing, history (a call or visit whose lead id names no lead
-- stays as it is). ON DELETE SET NULL, as the visit's project and listing.

ALTER TABLE "Call" ADD CONSTRAINT "Call_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
