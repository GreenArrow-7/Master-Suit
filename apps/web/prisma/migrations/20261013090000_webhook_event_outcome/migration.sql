-- A lead source's delivery records what the intake made of it and the lead it
-- made or joined, for the Deliveries tab (Lead Eagle audit rows M6-21, M6-22).
-- Additive: two nullable columns; earlier rows keep NULL and read as processed.
ALTER TABLE "WebhookEvent" ADD COLUMN "outcome" TEXT,
ADD COLUMN "leadId" TEXT;
