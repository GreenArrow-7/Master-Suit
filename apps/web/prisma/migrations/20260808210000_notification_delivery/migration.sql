-- Delivery state for notifications.
--
-- The in-app row is written synchronously and the email is queued, so "was this
-- person actually told?" has two different answers and only one of them was
-- recorded. These two columns make the second one answerable: `emailedAt` is
-- stamped by the notifications worker on success, `emailError` on failure, and
-- the worker's retry filters on `emailedAt IS NULL` so a retry cannot send the
-- same message twice.
ALTER TABLE "Notification" ADD COLUMN "emailedAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "emailError" TEXT;

-- The worker's own lookup: everything for one tenant and event that has not been
-- emailed yet.
CREATE INDEX "Notification_tenantId_kind_emailedAt_idx" ON "Notification"("tenantId", "kind", "emailedAt");
