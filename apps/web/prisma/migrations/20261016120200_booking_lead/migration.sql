-- M3-17: a booking names its lead as a relation, so the Real Estate board's
-- booking and revenue figures follow the lead's source. Additive, NOT VALID
-- (history is neither scanned nor refused), ON DELETE SET NULL. The leadId
-- index already exists.

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
