-- Recordings, transcripts and stored documents need asking for by name.
--
-- A monitoring authorisation covers the workspace's operational surface: leads,
-- follow-ups, call *metadata*, activity, site visits, SLA exceptions. The
-- recording of a client's conversation, its transcript, and the documents
-- attached to a record are a different order of thing — they are the customer's
-- customers speaking — and "I can see the call list" should not carry them.
--
-- A flag on the grant rather than a third PlatformGrantKind. A kind answers
-- "what may this person do" (read / write) and would make `sensitive` a second
-- axis pretending to be a point on the first: a READ+sensitive and a WRITE grant
-- are not two values of one enum. As a column it rides the object that already
-- carries the reason, the expiry and the revocation — so withdrawing it is the
-- same act, on the same row, with the same trail.
--
-- Defaults false everywhere, including for grants that already exist: an
-- authorisation issued before this column existed was not an authorisation to
-- read transcripts, and must not silently become one.

-- AlterTable
ALTER TABLE "PlatformAccessGrant" ADD COLUMN "sensitive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlatformCoverageGrant" ADD COLUMN "sensitive" BOOLEAN NOT NULL DEFAULT false;

-- Break-glass already reaches everything by construction — `buildSupportActor`
-- gives a live WRITE grant every permission in the catalogue — so marking those
-- rows keeps the column an honest description of what the grant confers rather
-- than a second gate that disagrees with the first.
UPDATE "PlatformAccessGrant" SET "sensitive" = true WHERE "kind" = 'WRITE';
