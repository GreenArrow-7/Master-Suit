-- A session now says what it is for.
--
-- `FULL` is an ordinary signed-in session and is the default, so every existing
-- row keeps exactly the access it had. `MFA_ENROLMENT` is the restricted grant
-- issued when a workspace mandates two-factor authentication and the user has
-- not enrolled: it reaches the enrolment, verification and logout endpoints and
-- nothing else.
--
-- Before this, mandating 2FA demanded a TOTP code from users who had no secret
-- to generate one with, and there was no path to enrol. The setting locked out
-- everyone who had not already enrolled, with no way back in.
ALTER TABLE "PlatformSession" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'FULL';

-- Restricted sessions are short-lived and looked up on every request that
-- carries one; the partial index keeps that off the main hot path.
CREATE INDEX "PlatformSession_purpose_idx" ON "PlatformSession" ("purpose") WHERE "purpose" <> 'FULL';
