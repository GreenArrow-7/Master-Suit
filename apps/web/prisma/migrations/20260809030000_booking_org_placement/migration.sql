-- M10 — where the agent sat when the sale was confirmed.
--
-- A P&L rolled up through the agent's *current* team silently moves last
-- quarter's revenue the moment somebody transfers, which restates a period that
-- was closed. Same reasoning as the frozen commission slab in M9: the rollup has
-- to keep answering what it answered at the time.
--
-- Nullable rather than backfilled from current placement, because guessing is
-- the failure being prevented. A booking confirmed before this migration has no
-- recorded placement and the rollup reports it as unassigned rather than
-- inventing one.

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "regionId" TEXT,
ADD COLUMN     "teamId" TEXT;

-- CreateIndex
CREATE INDEX "Booking_tenantId_teamId_bookingDate_idx" ON "Booking"("tenantId", "teamId", "bookingDate");

-- CreateIndex
CREATE INDEX "Booking_tenantId_regionId_bookingDate_idx" ON "Booking"("tenantId", "regionId", "bookingDate");

-- No new permission module: a leader reading their own subtree's numbers is
-- `reports:VIEW`, which already exists and already carries the scope that
-- decides how far down the tree they can see.
