-- Event record visibility.
--
-- Until now `GET /api/v1/events` filtered on `tenantId` alone: a user holding
-- `events:VIEW` at OWN saw every event in the company, and the detail and child
-- routes did not scope either. That is the same class of hole as the call detail
-- routes, but it cannot be closed the same way, because events are genuinely
-- shared objects — an all-hands or an office closure is *meant* to be seen by
-- everyone, and an invitee must be able to see the event they were invited to
-- even when its host sits outside their scope.
--
-- So visibility becomes an explicit property of the event rather than an
-- accident of the query.
CREATE TYPE "EventVisibility" AS ENUM ('SCOPED', 'ORGANIZATION');

ALTER TABLE "Event"
  ADD COLUMN "visibility" "EventVisibility" NOT NULL DEFAULT 'SCOPED';

-- ── Data: no existing event may disappear ───────────────────────────────────
--
-- Every row that exists today is visible to every member of its workspace,
-- because that is what the unscoped query did. Taking the new column's default
-- would silently hide most of them from most people the moment this deploys —
-- a customer-visible regression dressed up as a security fix.
--
-- Existing rows are therefore stamped ORGANIZATION, which preserves exactly the
-- visibility they have right now. Only events created *after* this migration
-- get the scoped default, where the choice is a deliberate one made by whoever
-- creates them.
UPDATE "Event" SET "visibility" = 'ORGANIZATION';

-- Lists filter on (tenantId, visibility) before anything else.
CREATE INDEX "Event_tenantId_visibility_idx" ON "Event"("tenantId", "visibility");
