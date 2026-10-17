-- The morning summary (audit M8-04, M17-04): when it last went to this person, so
-- it goes once a day and lists the leads given since the last one. Additive.
ALTER TABLE "User" ADD COLUMN "digestSentAt" TIMESTAMP(3);
