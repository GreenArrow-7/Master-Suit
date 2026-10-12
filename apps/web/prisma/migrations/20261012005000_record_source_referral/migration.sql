-- Referral as a lead source (Lead Eagle audit row M6-15): a lead attributed to
-- the person who referred it, whose name is kept in `sourceDetail`. Additive;
-- nothing is rewritten.
ALTER TYPE "RecordSource" ADD VALUE IF NOT EXISTS 'REFERRAL';
