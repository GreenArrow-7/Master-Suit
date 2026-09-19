-- Authenticator replay prevention.
--
-- The last accepted TOTP time step per identity. NULL means no code has been
-- accepted since this column existed; the first accepted code sets it. Nothing is
-- backfilled and nothing is revoked: existing sessions and enrolments are
-- unchanged, and a code already used before the upgrade can still be used once
-- more within its remaining ~90 seconds, which is the state before this release.

ALTER TABLE "PlatformUser" ADD COLUMN "mfaLastUsedStep" INTEGER;
