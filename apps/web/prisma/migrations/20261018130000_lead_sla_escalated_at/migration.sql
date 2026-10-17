-- The recurring first-contact sweep (audit M17-08): when the lead's owner at the
-- time was last escalated for missing first contact, so each hand-over is
-- escalated once. Additive; leads already breached count as escalated for the
-- owner they have now, so the first sweep does not tell their managers twice.
ALTER TABLE "Lead" ADD COLUMN "slaEscalatedAt" TIMESTAMP(3);
UPDATE "Lead" SET "slaEscalatedAt" = NOW() WHERE "slaState" = 'BREACHED';
