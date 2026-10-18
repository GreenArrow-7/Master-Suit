-- Weighted assignment (audit M7-02): the next slot of a weighted rule's rotation.
-- A person weighted n holds n slots per round, so the person assigned last no
-- longer says where the turn is; this does. Additive, defaulted.
ALTER TABLE "DistributionRule" ADD COLUMN "rotationSlot" INTEGER NOT NULL DEFAULT 0;
