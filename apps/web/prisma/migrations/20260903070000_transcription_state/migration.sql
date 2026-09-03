-- Where the transcription of one call got to, on the call itself.
--
-- Absence of a Transcript row was the only signal, and it is four different
-- situations wearing one face: never asked for, queued, deliberately skipped
-- (no consent, no provider, no speech), or beaten after every retry. Only the
-- last one needs a person, and nobody could tell it from the other three.
--
-- Additive: every existing call gets PENDING, which is what "we do not know"
-- has always meant for a row written before this column existed. Backfilling
-- READY from the presence of a transcript is deliberately NOT done here — see
-- the UPDATE below, which does exactly that and nothing else.

CREATE TYPE "TranscriptionState" AS ENUM ('PENDING', 'RETRYING', 'SKIPPED', 'READY', 'FAILED');

ALTER TABLE "Call"
  ADD COLUMN "transcriptionState" "TranscriptionState" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "transcriptionDetail" TEXT,
  ADD COLUMN "transcriptionAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "transcriptionUpdatedAt" TIMESTAMP(3);

-- A call that already has a transcript is READY, and saying PENDING about it
-- would be a fresh lie rather than an honest absence. Attempts stay 0: nobody
-- counted them at the time and inventing a number would be worse than zero.
UPDATE "Call" AS c
   SET "transcriptionState" = 'READY'
  FROM "Transcript" AS t
 WHERE t."callId" = c."id";
