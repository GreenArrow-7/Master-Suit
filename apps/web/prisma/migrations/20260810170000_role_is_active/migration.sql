-- HRMS-v21 §1: a role with assignment history cannot be deleted, only
-- deactivated. This is the flag deactivation sets; an inactive role grants
-- nothing (buildActor skips it) and cannot be assigned.
ALTER TABLE "Role" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
