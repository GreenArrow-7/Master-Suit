-- Response deadlines for social enquiries.
--
-- Only two columns, because the SLA *state* is derived at read time from the
-- deadline rather than stored. A stored state has to be kept true by a job, and
-- a job that is late or lost leaves a row lying about itself; `slaDueAt` and the
-- clock can never disagree.
--
-- No new policy table either: the tenant's existing "SLA" rows already carry
-- firstResponseMins and warningThresholdPct.

ALTER TABLE "SocialComment" ADD COLUMN "slaDueAt" TIMESTAMP(3);
ALTER TABLE "SocialComment" ADD COLUMN "slaEscalatedAt" TIMESTAMP(3);

CREATE INDEX "SocialComment_tenantId_slaDueAt_idx" ON "SocialComment"("tenantId", "slaDueAt");
