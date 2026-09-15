-- One confirmed sale per unit, and every confirmed sale naming a unit.
--
-- The application now takes the unit's row lock before it writes the booking
-- (services/inventory/unitStatus.ts `moveUnitIn`, called from the bookings
-- CONFIRM branch). These two constraints are the floor under that: they hold
-- when the application is bypassed — a script, a console session, a future
-- route that forgets — which is the only place a double-sale can still be
-- typed in.
--
-- Both predicates exclude soft-deleted rows and match each other exactly, so a
-- cancelled-and-deleted booking neither blocks the unit's resale nor trips the
-- policy check.

-- Policy (client decision, 2026-09-12): every confirmed booking identifies one
-- specific inventory unit. NOT VALID so the deploy takes no full-table scan and
-- cannot fail on historical rows; the separate validate migration that follows
-- is where existing data is held to it.
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_confirmed_requires_unit"
  CHECK (
    "status" <> 'CONFIRMED'
    OR "deletedAt" IS NOT NULL
    OR "unitInventoryId" IS NOT NULL
  ) NOT VALID;

-- The double-sale itself. Two concurrent confirmations against one unit both
-- returned 200 before this existed.
CREATE UNIQUE INDEX "Booking_one_confirmed_per_unit"
  ON "Booking" ("unitInventoryId")
  WHERE "status" = 'CONFIRMED' AND "deletedAt" IS NULL AND "unitInventoryId" IS NOT NULL;
