-- PROP-05: the conversation time a telephony vendor reports, kept apart from the
-- leg time (durationSecs, which includes the ring).
ALTER TABLE "Call" ADD COLUMN "talkSecs" INTEGER;
