-- The invitation form asks for an employment type and a joining date. The
-- joining date already had somewhere to live; the employment type did not, so
-- it was dropped on the floor and every accepted hire came out with a blank
-- employment type nobody could explain.
ALTER TABLE "WorkspaceInvitation" ADD COLUMN "employmentType" TEXT;
